/**
 * Medusa Long-Running Workflow for Textile Product Extraction
 *
 * This workflow extracts e-commerce ready product information from textile images.
 * It follows the long-running workflow pattern with:
 * 1. Trigger API returns transaction_id (202 status)
 * 2. Async step suspends workflow until confirmed
 * 3. Confirm API resumes workflow
 * 4. Background execution for AI processing
 */

import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
  WorkflowData,
  transform,
} from "@medusajs/framework/workflows-sdk";
import { MedusaError } from "@medusajs/framework/utils";
import { notifyOnFailureStep, sendNotificationsStep } from "@medusajs/medusa/core-flows";
import { mastra } from "../../mastra";
import MediaService from "../../modules/media/service";
import type { MedusaContainer } from "@medusajs/framework";
import { persistTextileAnalysis } from "../../modules/textile-analysis/lib/persist";
import { TEXTILE_ANALYSIS_MODULE } from "../../modules/textile-analysis";
import { resolveRoleVisionModels } from "../../mastra/services/ai-platforms";
import {
  setTextileModelsForRun,
  clearTextileModelsForRun,
} from "../../mastra/agents/textileExtractionAgent";

/** Vision role the textile extraction resolves its provider ladder from. */
const TEXTILE_VISION_ROLE = "ai_image_extraction";

// ============================================
// Types
// ============================================

export type TextileProductExtractionInput = {
  media_id: string;
  image_url: string;
  hints?: string[];
  gender?: "female" | "male" | "unisex";
  persist?: boolean;
  threadId?: string;
  resourceId?: string;
};

export type VisualObservations = {
  visible_colors?: string[];
  visible_pattern?: string | null;
  pattern_description?: string | null;
  design_elements?: string[];
  fabric?: {
    type_idea?: string | null;
    texture?: string | null;
    weave_or_knit?: string | null;
    perceived_weight?: string | null;
    finish?: string | null;
  };
  visible_item?: string | null;
  visible_text?: string[];
  shot_type?: string | null;
  not_visible_or_uncertain?: string[];
};

export type TextileProductExtractionOutput = {
  // Garment / product catalog fields
  title: string;
  description: string;
  designer?: string | null;
  model_name?: string | null;
  cloth_type?: string | null;
  pattern?: string | null;
  fabric_weight?: string | null;
  care_instructions?: string[];
  season?: string[];
  occasion?: string[];
  colors?: string[];
  category?: string | null;
  suggested_price?: { amount: number; currency: string } | null;
  seo_keywords?: string[];
  target_audience?: string | null;
  confidence?: number;

  // Visible-only observations from the feedback-oriented first pass
  visual_observations?: VisualObservations | null;

  // Raw internal fields — not for customer display
  face_raw?: {
    estimated_age_range?: string | null;
    skin_tone?: string | null;
    hair_color?: string | null;
    hair_style?: string | null;
    eye_color?: string | null;
    facial_features?: string[];
  } | null;
  body_raw?: {
    body_type?: string | null;
    estimated_height?: string | null;
    pose?: string | null;
    skin_tone?: string | null;
  } | null;
  model_characteristics?: {
    gender_presentation?: string | null;
    styling?: string | null;
    overall_vibe?: string | null;
    shot_type?: string | null;
  } | null;
};

export type TextileExtractionSummary = {
  media_id: string;
  status: "pending_confirmation" | "processing" | "completed" | "failed";
  message: string;
};

// ============================================
// Workflow IDs (exported for confirm endpoint)
// ============================================

export const textileExtractionWorkflowId = "textile-product-extraction-medusa";
export const waitConfirmationTextileExtractionStepId = "wait-confirmation-textile-extraction";

// ============================================
// Steps
// ============================================

/**
 * Async wait step - suspends workflow until confirmed.
 * This makes the workflow a Long-Running Workflow.
 */
export const waitConfirmationTextileExtractionStep = createStep(
  {
    name: waitConfirmationTextileExtractionStepId,
    async: true,
    // Timeout after 1 hour to prevent orphaned workflows
    timeout: 60 * 60 * 1,
  },
  async () => {
    // Empty body - step suspends here until workflowEngineService.setStepSuccess() is called
  }
);

/**
 * Shared runner for the Mastra textile extraction workflow.
 * Used by the per-media workflow step and the folder-wide
 * rate-limited extraction workflow.
 */
export const runTextileMastraExtraction = async (input: {
  image_url: string;
  hints?: string[];
  gender?: string;
  threadId?: string;
  resourceId?: string;
}, container?: MedusaContainer): Promise<TextileProductExtractionOutput> => {
  const workflow = mastra.getWorkflow("textileProductExtractionWorkflow");
  const run = await workflow.createRun();

  // Generate threadId and resourceId if not provided (required for Memory)
  const threadId = input.threadId || `textile-thread-${Date.now()}`;
  const resourceId = input.resourceId || `textile-extraction:${Date.now()}`;

  // Resolve the admin-configured vision ladder (Cloudflare → Groq → …) and
  // hand the built models to the Mastra workflow by runId (the Mastra runtime
  // has no container). Falls back to the OpenRouter `:free` ladder inside the
  // workflow when no platform is configured.
  if (container) {
    try {
      const resolved = await resolveRoleVisionModels(container, TEXTILE_VISION_ROLE);
      if (resolved.length) {
        setTextileModelsForRun(run.runId, resolved.map((r) => r.model));
      }
    } catch (e: any) {
      console.warn(
        `[textile-extraction] vision provider resolution failed, using free fallback: ${e?.message ?? e}`
      );
    }
  }

  // Execute the workflow
  let workflowResult: any;
  try {
    workflowResult = await run.start({
      inputData: {
        image_url: input.image_url,
        hints: input.hints || [],
        gender: (input.gender as any) || "unisex",
        threadId,
        resourceId,
        run_id: run.runId,
      },
    });
  } finally {
    if (container) clearTextileModelsForRun(run.runId);
  }

  // Check validation step result
  if (workflowResult.steps.validateTextileExtraction?.status === "success") {
    const output = workflowResult.steps.validateTextileExtraction.output as TextileProductExtractionOutput;
    return output;
  }

  // Fallback: check derivation step
  if (workflowResult.steps.deriveProductFields?.status === "success") {
    const output = workflowResult.steps.deriveProductFields.output as TextileProductExtractionOutput;
    return output;
  }

  // Check for errors
  const failedStep = Object.entries(workflowResult.steps).find(([, step]) => (step as any).status === "failed");
  if (failedStep) {
    throw new MedusaError(
      MedusaError.Types.UNEXPECTED_STATE,
      `Textile extraction failed at step ${failedStep[0]}: ${failedStep[1] || "Unknown error"}`
    );
  }

  throw new MedusaError(
    MedusaError.Types.UNEXPECTED_STATE,
    "Textile extraction workflow completed but no valid output found"
  );
};

/**
 * Step to run the Mastra textile extraction workflow
 */
const runMastraTextileExtractionStep = createStep(
  "run-mastra-textile-extraction",
  async (
    input: { image_url: string; hints?: string[]; gender?: string; threadId?: string; resourceId?: string },
    { container }
  ) => {
    try {
      return new StepResponse(await runTextileMastraExtraction(input, container));
    } catch (error: any) {
      if (error instanceof MedusaError) throw error;
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        `Textile extraction failed: ${error?.message || String(error)}`
      );
    }
  },
  // Compensation function (optional - for rollback on failure)
  async () => {
    // No rollback needed for extraction
  }
);

/**
 * Persist extraction results as a typed `textile_analysis` row.
 *
 * ## What changed, and why
 *
 * This used to write `MediaFile.metadata.textile_extraction` — a JSON blob on a
 * shared bag — and to replace the whole `metadata` object doing it. Two
 * problems, one fatal:
 *
 * 1. **It could not be filtered.** `query.graph` does not reach into JSON
 *    subkeys, so "show me more fabrics like this" (pattern / weight / cloth
 *    type) — the feature this data exists to serve — was not buildable on it.
 * 2. **It bypassed columns that already existed.** Of the 37 production media
 *    files carrying the blob, 37 had a `title` and `description` inside it and
 *    **0** had the typed `MediaFile.title` / `description` / `alt_text` set,
 *    with `title` one of the two `.searchable()` fields.
 *
 * ⚠️ The signature keeps `mediaService` it no longer uses, so every caller —
 * the per-media workflow and the folder-wide one — stays untouched. Removing
 * the argument is a separate, mechanical change; doing it here would mix a
 * storage cutover with a call-site sweep.
 */
export const persistTextileExtractionResult = async (
  _mediaService: MediaService,
  media_id: string,
  extraction: TextileProductExtractionOutput,
  container?: MedusaContainer
): Promise<void> => {
  if (!container) {
    // Nothing to write into without a container. Loud, because a silently
    // skipped persist is how 37 extractions became write-only in the first
    // place.
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "persistTextileExtractionResult needs the container to write a textile_analysis row."
    );
  }
  await persistTextileAnalysis(container, {
    media_id,
    payload: extraction as unknown as Record<string, any>,
    source: "internal_extraction",
  });
};

/**
 * Step to persist extraction results to media metadata (optional)
 */
const persistExtractionResultsStep = createStep(
  "persist-textile-extraction-results",
  async (
    input: {
      media_id: string;
      extraction: TextileProductExtractionOutput;
      persist: boolean;
    },
    { container }
  ) => {
    if (!input.persist) {
      return new StepResponse({ persisted: false, media_id: input.media_id, analysis_id: null as string | null });
    }

    try {
      const { analysis_id } = await persistTextileAnalysis(container, {
        media_id: input.media_id,
        payload: input.extraction as unknown as Record<string, any>,
        source: "internal_extraction",
      });

      return new StepResponse({
        persisted: true,
        media_id: input.media_id,
        analysis_id,
      });
    } catch (error: any) {
      console.error(`Failed to persist extraction results: ${error?.message}`);
      return new StepResponse({ persisted: false, media_id: input.media_id, analysis_id: null as string | null, error: error?.message });
    }
  },
  /**
   * Compensation: delete the ROW, not a metadata key.
   *
   * ⚠️ The old version nulled `metadata.textile_extraction` AND
   * `metadata.extracted_at` by writing a fresh `metadata` object — on a bag
   * shared with the partner upload, WhatsApp and raw-material-binding writers.
   * A rollback therefore stood to erase provenance that had nothing to do with
   * this extraction. Deleting the analysis row touches only what this step
   * created.
   */
  async (data, { container }) => {
    if (!data?.persisted || !data?.analysis_id) return;
    try {
      const service: any = container.resolve(TEXTILE_ANALYSIS_MODULE);
      await service.deleteTextileAnalyses(data.analysis_id);
    } catch {}
  }
);

// ============================================
// Background Processing Workflow
// ============================================

type TextileExtractionProcessingInput = {
  image_url: string;
  hints?: string[];
  gender?: string;
  threadId?: string;
  resourceId?: string;
  media_id: string;
  persist: boolean;
};

/**
 * Internal workflow for running the actual textile extraction in background.
 * This is invoked via runAsStep with backgroundExecution: true
 */
export const textileExtractionProcessingWorkflow = createWorkflow(
  "textile-extraction-processing",
  (input: WorkflowData<TextileExtractionProcessingInput>) => {
    // Run Mastra extraction
    const extractionInput = transform({ input }, (data) => ({
      image_url: data.input.image_url,
      hints: data.input.hints,
      gender: data.input.gender,
      threadId: data.input.threadId,
      resourceId: data.input.resourceId,
    }));

    const extractionResult = runMastraTextileExtractionStep(extractionInput);

    // Persist results if requested
    const persistInput = transform({ input, extractionResult }, (data) => ({
      media_id: data.input.media_id,
      extraction: data.extractionResult,
      persist: data.input.persist ?? false,
    }));

    persistExtractionResultsStep(persistInput);

    // Return extraction result
    return new WorkflowResponse(extractionResult);
  }
);

// ============================================
// Main Workflow Definition
// ============================================

/**
 * Long-running workflow for textile product extraction.
 *
 * Usage:
 * 1. Trigger via POST /admin/medias/extract-features with media_id
 * 2. Returns transaction_id (202 Accepted)
 * 3. Confirm via POST /admin/medias/extract-features/:transaction_id/confirm
 * 4. Extraction runs in background, notifications sent on completion
 *
 * @example
 * ```ts
 * const { result, transaction } = await textileProductExtractionMedusaWorkflow(container).run({
 *   input: {
 *     media_id: "media_123",
 *     image_url: "https://example.com/product.jpg",
 *     hints: ["focus on fabric details"],
 *     persist: true,
 *   },
 * });
 *
 * // transaction.transactionId can be used to confirm the workflow
 * ```
 */
export const textileProductExtractionMedusaWorkflow = createWorkflow(
  {
    name: textileExtractionWorkflowId,
    store: true, // Enable state persistence for long-running execution
  },
  (
    input: WorkflowData<TextileProductExtractionInput>
  ): WorkflowResponse<TextileExtractionSummary> => {
    // Create initial summary for response before confirmation
    const initialSummary = transform({ input }, (data) => ({
      media_id: data.input.media_id,
      status: "pending_confirmation" as const,
      message: `Textile product extraction ready for media ${data.input.media_id}. Confirm to start processing.`,
    }));

    // Wait for user confirmation (suspends workflow here)
    waitConfirmationTextileExtractionStep();

    // Failure notification configuration
    const failureNotification = transform({ input }, (data) => [
      {
        to: "",
        channel: "feed" as const,
        template: "admin-ui" as const,
        data: {
          title: "Textile Extraction Failed",
          description: `Failed to extract product features from media ${data.input.media_id}`,
        },
      },
    ]);

    notifyOnFailureStep(failureNotification);

    // Run Mastra extraction workflow in background
    const extractionInput = transform({ input }, (data) => ({
      image_url: data.input.image_url,
      hints: data.input.hints,
      gender: data.input.gender,
      threadId: data.input.threadId,
      resourceId: data.input.resourceId,
      media_id: data.input.media_id,
      persist: data.input.persist ?? false,
    }));

    // Use runAsStep with backgroundExecution for heavy AI processing
    textileExtractionProcessingWorkflow
      .runAsStep({ input: extractionInput })
      .config({ async: true, backgroundExecution: true });

    // Success notification (will run after background processing completes)
    const successNotification = transform({ input }, (data) => [
      {
        to: "",
        channel: "feed" as const,
        template: "admin-ui" as const,
        data: {
          title: "Textile Extraction Started",
          description: `Processing textile extraction for media ${data.input.media_id}`,
        },
      },
    ]);

    sendNotificationsStep(successNotification);

    // Return summary (this is what the initial trigger returns)
    return new WorkflowResponse(initialSummary);
  }
);

export default textileProductExtractionMedusaWorkflow;
