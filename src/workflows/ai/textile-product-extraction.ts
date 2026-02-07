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

// ============================================
// Types
// ============================================

export type TextileProductExtractionInput = {
  media_id: string;
  image_url: string;
  hints?: string[];
  persist?: boolean;
  threadId?: string;
  resourceId?: string;
};

export type TextileProductExtractionOutput = {
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
 * Step to run the Mastra textile extraction workflow
 */
const runMastraTextileExtractionStep = createStep(
  "run-mastra-textile-extraction",
  async (input: { image_url: string; hints?: string[]; threadId?: string; resourceId?: string }) => {
    try {
      // Get the Mastra workflow
      const workflow = mastra.getWorkflow("textileProductExtractionWorkflow");
      const run = await workflow.createRunAsync();

      // Generate threadId and resourceId if not provided (required for Memory)
      const threadId = input.threadId || `textile-thread-${Date.now()}`;
      const resourceId = input.resourceId || `textile-extraction:${Date.now()}`;

      // Execute the workflow
      const workflowResult = await run.start({
        inputData: {
          image_url: input.image_url,
          hints: input.hints || [],
          threadId,
          resourceId,
        },
      });

      // Check validation step result
      if (workflowResult.steps.validateTextileExtraction?.status === "success") {
        const output = workflowResult.steps.validateTextileExtraction.output as TextileProductExtractionOutput;
        return new StepResponse(output);
      }

      // Fallback: check extraction step
      if (workflowResult.steps.extractTextileFeatures?.status === "success") {
        const output = workflowResult.steps.extractTextileFeatures.output as TextileProductExtractionOutput;
        return new StepResponse(output);
      }

      // Check for errors
      const failedStep = Object.entries(workflowResult.steps).find(([, step]) => step.status === "failed");
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
      return new StepResponse({ persisted: false, media_id: input.media_id });
    }

    try {
      // Resolve media service to update metadata
      const mediaService: MediaService = container.resolve("media");

      await mediaService.updateMediaFiles({
        id: input.media_id,
        metadata: {
          textile_extraction: input.extraction,
          extracted_at: new Date().toISOString(),
        },
      });

      return new StepResponse({ persisted: true, media_id: input.media_id });
    } catch (error: any) {
      console.error(`Failed to persist extraction results: ${error?.message}`);
      return new StepResponse({ persisted: false, media_id: input.media_id, error: error?.message });
    }
  },
  // Compensation: remove metadata on failure
  async (data, { container }) => {
    if (!data?.persisted) return;
    try {
      const mediaService: MediaService = container.resolve("media");
      await mediaService.updateMediaFiles({
        id: data.media_id,
        metadata: {
          textile_extraction: null,
          extracted_at: null,
        },
      });
    } catch {}
  }
);

// ============================================
// Background Processing Workflow
// ============================================

type TextileExtractionProcessingInput = {
  image_url: string;
  hints?: string[];
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
