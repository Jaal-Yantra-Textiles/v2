/**
 * @file Admin API route for folder-wide extraction progress
 * @description Returns live progress of the folder feature extraction job
 *              (mirrored into the folder's metadata by the workflow).
 * @module API/Admin/Medias/Folder/ExtractFeatures/Status
 */

/**
 * Get folder extraction progress
 * @route GET /admin/medias/folder/{id}/extract-features/status
 * @group Media - Media management operations
 *
 * @returns {ExtractFolderFeaturesStatusResponse} 200 - Progress info
 * @throws {MedusaError} 404 - Folder not found
 *
 * @example response 200
 * {
 *   "folder_id": "folder_123",
 *   "has_run": true,
 *   "progress": {
 *     "status": "running",
 *     "total": 14,
 *     "completed": 5,
 *     "failed": 0,
 *     "interval_ms": 60000,
 *     "started_at": "2026-08-30T10:00:00.000Z",
 *     "updated_at": "2026-08-30T10:05:12.000Z"
 *   }
 * }
 */

import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils";
import MediaService from "../../../../../../../modules/media/service";
import { MEDIA_MODULE } from "../../../../../../../modules/media";
import { FolderExtractionProgress } from "../../../../../../../workflows/ai/textile-folder-extraction";
import {
  folderExtractionLiveness,
  pendingFolderExtractionMedia,
} from "../../../../../../../workflows/ai/lib/folder-extraction-resume";

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const logger: any = req.scope.resolve(ContainerRegistrationKeys.LOGGER);
  try {
    const folder_id = req.params.id;

    const mediaService = req.scope.resolve(MEDIA_MODULE) as MediaService;
    const folder = await mediaService.retrieveFolder(folder_id).catch(() => null);

    if (!folder) {
      throw new MedusaError(MedusaError.Types.NOT_FOUND, `Folder not found: ${folder_id}`);
    }

    const progress = (folder.metadata?.folder_extraction as FolderExtractionProgress) || null;

    /**
     * 🔴 `status` alone cannot answer "is this still going?" (#1742).
     *
     * The loop runs inside one step in one Node process; when a deploy replaces
     * the task the process dies without writing anything — least of all "I
     * died" — so `status` stays the string `"running"` for ever. On production
     * a folder sat at 18/62 with `status: "running"` for five hours while every
     * task that could have been running it had been replaced twice.
     *
     * The only evidence of liveness is how long ago progress was written, and
     * progress is written after EVERY item. So the route computes the verdict
     * rather than making each caller re-derive it — the admin strip, the
     * sweeper and anyone with curl otherwise each invent their own threshold.
     */
    const liveness = folderExtractionLiveness(progress);

    /**
     * The outstanding count comes from the same place a resume gets its
     * work-list, so the number on screen and the number that would actually be
     * processed cannot disagree. Best-effort: a folder that has never been
     * extracted still answers, and a link failure must not 500 a status poll
     * the UI hits every 5 seconds.
     */
    let pending_count: number | null = null;
    let folder_total: number | null = null;
    try {
      const pending = await pendingFolderExtractionMedia(req.scope, folder_id);
      pending_count = pending.pending_media_ids.length;
      folder_total = pending.all_media_ids.length;
    } catch (err: any) {
      logger.warn(
        `[FolderExtractFeatures/Status] Could not count pending media for ${folder_id}: ${err?.message}`
      );
    }

    return res.json({
      folder_id,
      has_run: !!progress,
      progress,
      stalled: liveness.stalled,
      silent_for_ms: liveness.silent_for_ms,
      stall_threshold_ms: liveness.threshold_ms,
      pending_count,
      folder_total,
      /**
       * True only when a resume would be both useful and permitted: there is
       * outstanding work AND nothing is currently working on it.
       *
       * ⚠️ The second half matters. Offering Resume beside a healthy run
       * invites a second loop over the same folder — every pending image
       * extracted twice, in parallel, at double the provider rate the pacing
       * exists to respect, and `link.create` is not idempotent so each leaves
       * its own duplicate row. The resume route refuses that; this stops the
       * screen from asking for it in the first place.
       */
      resumable:
        !!progress &&
        (pending_count ?? 0) > 0 &&
        !(progress.status === "running" && !liveness.stalled),
    });
  } catch (error) {
    logger.error(`[FolderExtractFeatures/Status] Error: ${error}`, error);

    if (error instanceof MedusaError) {
      const status = error.type === MedusaError.Types.NOT_FOUND ? 404 : 500;
      return res.status(status).json({ message: (error as Error).message });
    }

    return res.status(500).json({
      message: (error as any)?.message || "An unexpected error occurred",
    });
  }
};
