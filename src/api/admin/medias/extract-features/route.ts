/**
 * @file Admin API route for textile product feature extraction
 * @description Provides endpoints for extracting e-commerce ready product information from textile images
 * @module API/Admin/Medias/ExtractFeatures
 */

/**
 * Extract textile product features from a media file
 * @route POST /admin/medias/extract-features
 * @group Media - Media management operations
 *
 * @param {ExtractFeaturesRequest} request.body.required - Extraction request data
 * @returns {ExtractFeaturesResponse} 202 - Extraction initiated, returns transaction_id
 * @throws {MedusaError} 400 - Invalid request (missing media_id, media not found, not an image)
 * @throws {MedusaError} 500 - Internal server error
 *
 * @example request
 * POST /admin/medias/extract-features
 * {
 *   "media_id": "media_01HGRT12345",
 *   "hints": ["focus on fabric texture", "identify designer label"],
 *   "persist": true
 * }
 *
 * @example response 202
 * {
 *   "message": "Extraction initiated. Confirm to start processing.",
 *   "transaction_id": "txn_abc123def456",
 *   "status": "pending_confirmation"
 * }
 *
 * @description
 * This endpoint initiates a long-running workflow for extracting textile product features.
 *
 * Flow:
 * 1. POST /admin/medias/extract-features - Returns transaction_id (this endpoint)
 * 2. POST /admin/medias/extract-features/:transaction_id/confirm - Confirms and starts processing
 * 3. Extraction runs in background, notifications sent on completion
 *
 * Extracted fields include:
 * - title, description
 * - designer, model_name, cloth_type, pattern
 * - fabric_weight, care_instructions
 * - season, occasion, colors, category
 * - suggested_price, seo_keywords, target_audience
 * - confidence score
 */

import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { MedusaError } from "@medusajs/framework/utils";
import { ExtractFeaturesRequestSchema, ExtractFeaturesRequest } from "./validators";
import {
  textileProductExtractionMedusaWorkflow,
} from "../../../../workflows/ai/textile-product-extraction";

export const POST = async (
  req: MedusaRequest<ExtractFeaturesRequest>,
  res: MedusaResponse
) => {
  try {
    // Validate request body
    const parsed = ExtractFeaturesRequestSchema.safeParse(
      (req as any).validatedBody || req.body
    );

    if (!parsed.success) {
      const message = parsed.error.errors.map((e) => e.message).join(", ");
      throw new MedusaError(MedusaError.Types.INVALID_DATA, message || "Invalid request body");
    }

    const { media_id, hints, persist } = parsed.data;

    // Resolve media service to fetch the media file
    const mediaService = req.scope.resolve("media") as any;

    // Fetch the media file to get the image URL
    const mediaFiles = await mediaService.listMediaFiles(
      { id: media_id },
      { select: ["id", "file_path", "file_type", "mime_type"] }
    );

    if (!mediaFiles || mediaFiles.length === 0) {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        `Media file not found: ${media_id}`
      );
    }

    const mediaFile = mediaFiles[0];

    // Validate that it's an image
    if (mediaFile.file_type !== "image") {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `Media file must be an image. Got: ${mediaFile.file_type}`
      );
    }

    // Run the long-running workflow
    const { result, transaction } = await textileProductExtractionMedusaWorkflow(req.scope).run({
      input: {
        media_id,
        image_url: mediaFile.file_path,
        hints,
        persist,
      },
    });

    // Return 202 Accepted with transaction ID for confirmation
    return res.status(202).json({
      message: "Extraction initiated. Confirm to start processing.",
      transaction_id: transaction.transactionId,
      status: "pending_confirmation",
      summary: result,
    });
  } catch (error) {
    console.error("[ExtractFeatures] Error:", error);

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
