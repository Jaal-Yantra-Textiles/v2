/**
 * Medusa Long-Running Workflow for Folder-Wide Textile Feature Extraction
 *
 * Extracts features from EVERY image in a media folder as one
 * long-running, rate-limited background job:
 *
 * 1. Trigger API returns transaction_id (202 status)
 * 2. Async step suspends workflow until confirmed
 * 3. Confirm API resumes workflow
 * 4. Processing runs in the background, one photo at a time with a
 *    configurable interval (default: 1 photo per minute) so the AI
 *    provider is never rate limited.
 * 5. Progress is mirrored to the folder's metadata (folder_extraction)
 *    so the admin UI can poll status while the job runs.
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
import { MEDIA_MODULE } from "../../modules/media";
import MediaService from "../../modules/media/service";
import {
  runTextileMastraExtraction,
  persistTextileExtractionResult,
  TextileProductExtractionOutput,
} from "./textile-product-extraction";

// ============================================
// Types
// ============================================

export type TextileFolderExtractionInput = {
  folder_id: string;
  hints?: string[];
  gender?: "female" | "male" | "unisex";
  persist?: boolean;
  /** Milliseconds to wait between photos. Default 60000 (1 photo/minute). */
  interval_ms?: number;
};

export type FolderMediaItem = {
  media_id: string;
  image_url: string;
};

export type FolderMediaListOutput = {
  folder_id: string;
  folder_name: string;
  media: FolderMediaItem[];
  total: number;
  interval_ms: number;
  hints?: string[];
  gender?: string;
  persist: boolean;
};

export type FolderExtractionProgress = {
  status: "running" | "completed" | "failed";
  total: number;
  completed: number;
  failed: number;
  interval_ms: number;
  started_at: string;
  updated_at: string;
  finished_at?: string | null;
  last_media_id?: string | null;
  errors?: Array<{ media_id: string; error: string }>;
};

export type TextileFolderExtractionSummary = {
  folder_id: string;
  status: "pending_confirmation" | "processing";
  message: string;
  total_images?: number;
};

// ============================================
// Rate limiting constants
// ============================================

/** Default pacing: 1 photo per minute */
export const DEFAULT_FOLDER_EXTRACTION_INTERVAL_MS = 60 * 1000;
/** Never go faster than this regardless of configuration */
export const MIN_FOLDER_EXTRACTION_INTERVAL_MS = 5 * 1000;
/** Never wait longer than this between photos */
export const MAX_FOLDER_EXTRACTION_INTERVAL_MS = 15 * 60 * 1000;

const clampInterval = (ms?: number): number => {
  const value = typeof ms === "number" && !Number.isNaN(ms) ? ms : DEFAULT_FOLDER_EXTRACTION_INTERVAL_MS;
  return Math.min(Math.max(value, MIN_FOLDER_EXTRACTION_INTERVAL_MS), MAX_FOLDER_EXTRACTION_INTERVAL_MS);
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// ============================================
// Workflow IDs (exported for confirm endpoint)
// ============================================

export const textileFolderExtractionWorkflowId = "textile-folder-extraction";
export const waitConfirmationTextileFolderExtractionStepId = "wait-confirmation-textile-folder-extraction";

// ============================================
// Steps — Parent Workflow
// ============================================

/**
 * Async wait step - suspends workflow until confirmed.
 * Long timeout because folder jobs may be reviewed before starting.
 */
export const waitConfirmationTextileFolderExtractionStep = createStep(
  {
    name: waitConfirmationTextileFolderExtractionStepId,
    async: true,
    // Timeout after 24 hours to prevent orphaned workflows
    timeout: 60 * 60 * 24,
  },
  async () => {
    // Empty body - step suspends here until workflowEngineService.setStepSuccess() is called
  }
);

// ============================================
// Steps — Background Processing Workflow
// ============================================

/**
 * Lists all image media files belonging to the folder.
 */
const listFolderMediaStep = createStep(
  "list-folder-media-for-extraction",
  async (input: TextileFolderExtractionInput, { container }) => {
    const mediaService: MediaService = container.resolve(MEDIA_MODULE);

    const folder = await mediaService.retrieveFolder(input.folder_id).catch(() => null);
    if (!folder) {
      throw new MedusaError(MedusaError.Types.NOT_FOUND, `Folder not found: ${input.folder_id}`);
    }

    const mediaFiles = await mediaService.listMediaFiles(
      { folder_id: input.folder_id },
      { select: ["id", "file_path", "file_type"], order: { created_at: "ASC" } } as any
    );

    const images = (mediaFiles || []).filter((f: any) => f.file_type === "image" && f.file_path);

    if (images.length === 0) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `Folder ${input.folder_id} has no image files to extract features from`
      );
    }

    return new StepResponse({
      folder_id: input.folder_id,
      folder_name: folder.name,
      media: images.map((f: any) => ({ media_id: f.id, image_url: f.file_path })),
      total: images.length,
      interval_ms: clampInterval(input.interval_ms),
      hints: input.hints,
      gender: input.gender,
      persist: input.persist ?? false,
    });
  }
);

/**
 * Initializes the folder_extraction progress metadata on the folder.
 * Compensation clears the progress entry on rollback.
 */
const initFolderExtractionProgressStep = createStep(
  "init-folder-extraction-progress",
  async (input: FolderMediaListOutput, { container }) => {
    const mediaService: MediaService = container.resolve(MEDIA_MODULE);
    const folder = await mediaService.retrieveFolder(input.folder_id);

    const progress: FolderExtractionProgress = {
      status: "running",
      total: input.total,
      completed: 0,
      failed: 0,
      interval_ms: input.interval_ms,
      started_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      finished_at: null,
      last_media_id: null,
      errors: [],
    };

    await mediaService.updateFolders({
      selector: { id: input.folder_id },
      data: { metadata: { ...(folder.metadata || {}), folder_extraction: progress } },
    });

    return new StepResponse({ folder_id: input.folder_id, total: input.total }, { folder_id: input.folder_id });
  },
  // Compensation: remove the progress entry
  async (data: { folder_id: string } | undefined, { container }) => {
    if (!data?.folder_id) return;
    try {
      const mediaService: MediaService = container.resolve(MEDIA_MODULE);
      const folder = await mediaService.retrieveFolder(data.folder_id);
      const metadata = { ...(folder.metadata || {}) };
      delete metadata.folder_extraction;
      await mediaService.updateFolders({ selector: { id: data.folder_id }, data: { metadata } });
    } catch {}
  }
);

/**
 * Processes every photo in the folder SEQUENTIALLY, sleeping
 * `interval_ms` between photos (default 1 minute) so the vision
 * provider is never rate limited. Each photo's result is persisted
 * to the media metadata and progress is mirrored to the folder
 * metadata after every item.
 */
const processFolderMediaSequentiallyStep = createStep(
  "process-folder-media-sequentially",
  async (input: FolderMediaListOutput, { container }) => {
    const mediaService: MediaService = container.resolve(MEDIA_MODULE);

    let completed = 0;
    let failed = 0;
    const errors: Array<{ media_id: string; error: string }> = [];
    const results: Array<{ media_id: string; status: "completed" | "failed"; error?: string }> = [];

    const writeProgress = async (patch: Partial<FolderExtractionProgress>) => {
      try {
        const folder = await mediaService.retrieveFolder(input.folder_id);
        const existing = (folder.metadata?.folder_extraction as FolderExtractionProgress) || {};
        await mediaService.updateFolders({
          selector: { id: input.folder_id },
          data: {
            metadata: {
              ...(folder.metadata || {}),
              folder_extraction: {
                ...existing,
                ...patch,
                total: input.total,
                completed,
                failed,
                updated_at: new Date().toISOString(),
              },
            },
          },
        });
      } catch (err) {
        // Progress mirroring must never fail the extraction run
        console.error(`[TextileFolderExtraction] Failed to update progress: ${err}`);
      }
    };

    for (let i = 0; i < input.media.length; i++) {
      const item = input.media[i];
      const isLast = i === input.media.length - 1;

      try {
        const extraction: TextileProductExtractionOutput = await runTextileMastraExtraction({
          image_url: item.image_url,
          hints: input.hints,
          gender: input.gender,
          threadId: `textile-folder-${input.folder_id}-${item.media_id}`,
          resourceId: `textile-extraction:folder:${input.folder_id}:${item.media_id}`,
        }, container);

        if (input.persist) {
          await persistTextileExtractionResult(mediaService, item.media_id, extraction, container);
        }

        completed++;
        results.push({ media_id: item.media_id, status: "completed" });
        await writeProgress({ last_media_id: item.media_id });
      } catch (error: any) {
        failed++;
        const message = error?.message || String(error);
        errors.push({ media_id: item.media_id, error: message });
        if (errors.length > 20) errors.shift();
        results.push({ media_id: item.media_id, status: "failed", error: message });
        await writeProgress({
          last_media_id: item.media_id,
          errors: [...errors],
        });
      }

      // Rate limiting: 1 photo per interval (default 1 minute).
      // Only sleep BETWEEN photos, not after the last one.
      if (!isLast) {
        await sleep(input.interval_ms);
      }
    }

    const summary = {
      folder_id: input.folder_id,
      total: input.total,
      completed,
      failed,
    };

    return new StepResponse({ ...summary, results }, summary);
  }
);

/**
 * Marks the folder extraction as completed (or failed if every item failed)
 * in the folder metadata.
 */
const finalizeFolderExtractionStep = createStep(
  "finalize-folder-extraction",
  async (
    input: { folder_id: string; total: number; completed: number; failed: number },
    { container }
  ) => {
    const mediaService: MediaService = container.resolve(MEDIA_MODULE);
    const folder = await mediaService.retrieveFolder(input.folder_id);
    const existing = (folder.metadata?.folder_extraction as FolderExtractionProgress) || {};

    const status: FolderExtractionProgress["status"] =
      input.completed === 0 && input.failed > 0 ? "failed" : "completed";

    const progress: FolderExtractionProgress = {
      ...existing,
      status,
      total: input.total,
      completed: input.completed,
      failed: input.failed,
      updated_at: new Date().toISOString(),
      finished_at: new Date().toISOString(),
    };

    await mediaService.updateFolders({
      selector: { id: input.folder_id },
      data: { metadata: { ...(folder.metadata || {}), folder_extraction: progress } },
    });

    return new StepResponse({ ...input, status });
  }
);

// ============================================
// Background Processing Workflow
// ============================================

/**
 * Internal workflow that lists folder media, initializes progress and
 * processes every photo sequentially with rate limiting. Invoked via
 * runAsStep with backgroundExecution: true.
 */
export const textileFolderExtractionProcessingWorkflow = createWorkflow(
  "textile-folder-extraction-processing",
  (input: WorkflowData<TextileFolderExtractionInput>) => {
    const mediaList = listFolderMediaStep(input);

    const progressInput = transform({ mediaList }, (data) => data.mediaList);

    initFolderExtractionProgressStep(progressInput);

    const processingSummary = processFolderMediaSequentiallyStep(progressInput);

    const finalizeInput = transform({ processingSummary }, (data) => ({
      folder_id: data.processingSummary.folder_id,
      total: data.processingSummary.total,
      completed: data.processingSummary.completed,
      failed: data.processingSummary.failed,
    }));

    const finalized = finalizeFolderExtractionStep(finalizeInput);

    return new WorkflowResponse(finalized);
  }
);

// ============================================
// Main Workflow Definition
// ============================================

/**
 * Long-running workflow for folder-wide textile feature extraction.
 *
 * Usage:
 * 1. Trigger via POST /admin/medias/folder/:id/extract-features
 * 2. Returns transaction_id (202 Accepted)
 * 3. Confirm via POST /admin/medias/folder/:id/extract-features/:transaction_id/confirm
 * 4. Every image in the folder is extracted one at a time — 1 photo per
 *    minute by default — in the background. Poll GET
 *    /admin/medias/folder/:id/extract-features/status for progress.
 *
 * @example
 * ```ts
 * const { result, transaction } = await textileFolderExtractionMedusaWorkflow(container).run({
 *   input: {
 *     folder_id: "folder_123",
 *     persist: true,
 *     interval_ms: 60000, // 1 photo per minute
 *   },
 * });
 * ```
 */
export const textileFolderExtractionMedusaWorkflow = createWorkflow(
  {
    name: textileFolderExtractionWorkflowId,
    store: true, // Enable state persistence for long-running execution
  },
  (
    input: WorkflowData<TextileFolderExtractionInput>
  ): WorkflowResponse<TextileFolderExtractionSummary> => {
    // Create initial summary for response before confirmation
    const initialSummary = transform({ input }, (data) => ({
      folder_id: data.input.folder_id,
      status: "pending_confirmation" as const,
      message: `Folder-wide textile extraction ready for folder ${data.input.folder_id}. Confirm to start processing all images at 1 photo per minute.`,
    }));

    // Wait for user confirmation (suspends workflow here)
    waitConfirmationTextileFolderExtractionStep();

    // Failure notification configuration
    const failureNotification = transform({ input }, (data) => [
      {
        to: "",
        channel: "feed" as const,
        template: "admin-ui" as const,
        data: {
          title: "Folder Feature Extraction Failed",
          description: `Failed to run folder-wide feature extraction for folder ${data.input.folder_id}`,
        },
      },
    ]);

    notifyOnFailureStep(failureNotification);

    // Run folder processing in background (rate-limited, sequential)
    const processingInput = transform({ input }, (data) => ({
      folder_id: data.input.folder_id,
      hints: data.input.hints,
      gender: data.input.gender,
      persist: data.input.persist ?? false,
      interval_ms: data.input.interval_ms,
    }));

    // Use runAsStep with backgroundExecution for the long rate-limited run
    textileFolderExtractionProcessingWorkflow
      .runAsStep({ input: processingInput })
      .config({ async: true, backgroundExecution: true });

    // Success notification (will run after background processing completes)
    const successNotification = transform({ input }, (data) => [
      {
        to: "",
        channel: "feed" as const,
        template: "admin-ui" as const,
        data: {
          title: "Folder Feature Extraction Finished",
          description: `Finished extracting features from all images in folder ${data.input.folder_id}`,
        },
      },
    ]);

    sendNotificationsStep(successNotification);

    // Return summary (this is what the initial trigger returns)
    return new WorkflowResponse(initialSummary);
  }
);

export default textileFolderExtractionMedusaWorkflow;

