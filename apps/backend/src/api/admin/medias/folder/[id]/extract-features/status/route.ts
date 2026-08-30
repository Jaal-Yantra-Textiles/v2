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

    return res.json({
      folder_id,
      has_run: !!progress,
      progress,
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
