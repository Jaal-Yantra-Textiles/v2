/**
 * @file Admin API route for folder-wide textile feature extraction
 * @description Kicks off a long-running, rate-limited extraction of every
 *              image in a media folder (1 photo per minute by default).
 * @module API/Admin/Medias/Folder/ExtractFeatures
 */

/**
 * Extract features from all images in a media folder
 * @route POST /admin/medias/folder/{id}/extract-features
 * @group Media - Media management operations
 *
 * @param {ExtractFolderFeaturesRequest} request.body.optional - Extraction options
 * @returns {ExtractFolderFeaturesResponse} 202 - Extraction initiated, returns transaction_id
 * @throws {MedusaError} 404 - Folder not found
 * @throws {MedusaError} 400 - Folder has no images / invalid request
 *
 * @example request
 * POST /admin/medias/folder/folder_123/extract-features
 * { "persist": true, "interval_ms": 60000 }
 *
 * @example response 202
 * {
 *   "message": "Folder-wide extraction initiated. Confirm to start processing.",
 *   "transaction_id": "txn_abc123def456",
 *   "status": "pending_confirmation",
 *   "folder_id": "folder_123",
 *   "total_images": 14
 * }
 *
 * @description
 * This endpoint initiates a long-running workflow that extracts textile
 * product features from EVERY image in the folder. Processing is sequential
 * and rate limited (default 1 photo per minute) to avoid AI provider rate
 * limits. Progress can be polled via
 * GET /admin/medias/folder/{id}/extract-features/status.
 *
 * Flow:
 * 1. POST /admin/medias/folder/{id}/extract-features - Returns transaction_id
 * 2. POST /admin/medias/folder/{id}/extract-features/{transaction_id}/confirm
 * 3. Background processing runs one photo per minute until done
 */

import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils";
import { ExtractFolderFeaturesRequestSchema, ExtractFolderFeaturesRequest } from "./validators";
import { textileFolderExtractionMedusaWorkflow } from "../../../../../../workflows/ai/textile-folder-extraction";
import MediaService from "../../../../../../modules/media/service";
import { MEDIA_MODULE } from "../../../../../../modules/media";
import { pendingFolderExtractionMedia } from "../../../../../../workflows/ai/lib/folder-extraction-resume";

export const POST = async (
  req: MedusaRequest<ExtractFolderFeaturesRequest>,
  res: MedusaResponse
) => {
  const logger: any = req.scope.resolve(ContainerRegistrationKeys.LOGGER);
  try {
    // Validate request body
    const parsed = ExtractFolderFeaturesRequestSchema.safeParse(
      (req as any).validatedBody || req.body
    );

    if (!parsed.success) {
      const message = parsed.error.issues.map((e) => e.message).join(", ");
      throw new MedusaError(MedusaError.Types.INVALID_DATA, message || "Invalid request body");
    }

    const { hints, gender, persist, interval_ms, media_ids, scope } = parsed.data;
    const folder_id = req.params.id;

    // Verify folder exists and count extractable images for the response
    const mediaService = req.scope.resolve(MEDIA_MODULE) as MediaService;
    const folder = await mediaService.retrieveFolder(folder_id).catch(() => null);

    if (!folder) {
      throw new MedusaError(MedusaError.Types.NOT_FOUND, `Folder not found: ${folder_id}`);
    }

    const mediaFiles = await mediaService.listMediaFiles(
      { folder_id },
      { select: ["id", "file_type"] }
    );
    const imageCount = (mediaFiles || []).filter((f: any) => f.file_type === "image").length;

    if (imageCount === 0) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `Folder ${folder_id} has no image files to extract features from`
      );
    }

    /**
     * 🔴 Refuse an empty `scope: "pending"` run HERE, at the door (#1742).
     *
     * `listFolderMediaStep` throws the same refusal, but it runs inside the
     * background step AFTER confirmation — so the caller would get a cheerful
     * 202 and a transaction id, confirm it, and only then have the run die
     * where nobody is looking. The trigger already checks `imageCount` for
     * exactly this reason; the pending count is the same check for the scope
     * that was just added.
     */
    let pendingCount: number | null = null;
    if (scope === "pending") {
      const { pending_media_ids } = await pendingFolderExtractionMedia(
        req.scope,
        folder_id
      );
      pendingCount = media_ids?.length
        ? pending_media_ids.filter((id) => media_ids.includes(id)).length
        : pending_media_ids.length;

      if (pendingCount === 0) {
        throw new MedusaError(
          MedusaError.Types.INVALID_DATA,
          `Folder ${folder_id} has no images left to extract — every image already has a textile analysis`
        );
      }
    }

    // Run the long-running workflow
    const { result, transaction } = await textileFolderExtractionMedusaWorkflow(req.scope).run({
      input: {
        folder_id,
        hints,
        gender,
        persist,
        interval_ms,
        media_ids,
        scope,
      },
    });

    // Return 202 Accepted with transaction ID for confirmation
    return res.status(202).json({
      message: "Folder-wide extraction initiated. Confirm to start processing.",
      transaction_id: transaction.transactionId,
      status: "pending_confirmation",
      folder_id,
      total_images: imageCount,
      /** What this run will actually process — the folder, unless it is scoped. */
      scheduled_images: pendingCount ?? media_ids?.length ?? imageCount,
      scope,
      summary: result,
    });
  } catch (error) {
    logger.error(`[FolderExtractFeatures] Error: ${error}`, error);

    if (error instanceof MedusaError) {
      const status =
        error.type === MedusaError.Types.INVALID_DATA
          ? 400
          : error.type === MedusaError.Types.NOT_FOUND
            ? 404
            : 500;
      return res.status(status).json({ message: (error as Error).message });
    }

    return res.status(500).json({
      message: (error as any)?.message || "An unexpected error occurred",
    });
  }
};
