/**
 * @file Admin API route for AI-powered image extraction
 * @description Provides endpoints for extracting product information from images and optionally persisting the data
 * @module API/Admin/AI/ImageExtraction
 */

/**
 * @typedef {Object} AdminImageExtractionReq
 * @property {string} image_url.required - URL of the image to process
 * @property {string} entity_type.required - Type of entity to extract (e.g., "product", "variant")
 * @property {string} [notes] - Additional notes or context for the extraction
 * @property {string} [threadId] - ID of the associated thread or conversation
 * @property {string} [resourceId] - ID of the associated resource
 * @property {string[]} [hints] - Array of hints to guide the extraction process
 * @property {boolean} [verify=false] - Whether to verify the extracted data
 * @property {boolean} [persist=false] - Whether to persist the extracted data to the database
 * @property {Object} [defaults] - Default values to use for extracted fields
 */

/**
 * @typedef {Object} ImageExtractionResult
 * @property {Object} extracted_data - The extracted data from the image
 * @property {string} status - Status of the extraction process
 * @property {Object} [metadata] - Additional metadata about the extraction
 */

/**
 * @typedef {Object} ImageExtractionResponse
 * @property {string} message - Success message
 * @property {ImageExtractionResult} result - The extraction result
 */

/**
 * @typedef {Object} ImageExtractionError
 * @property {string} message - Error message
 */

/**
 * Extract information from an image using AI
 * @route POST /admin/ai/image-extraction
 * @group AI - AI-powered operations
 * @param {AdminImageExtractionReq} request.body.required - Image extraction request data
 * @returns {ImageExtractionResponse} 200 - Image processed successfully (without persistence)
 * @returns {ImageExtractionResponse} 201 - Image processed and records created (with persistence)
 * @throws {MedusaError} 400 - Invalid input data
 * @throws {MedusaError} 500 - Image extraction failed or unexpected error
 *
 * @example request
 * POST /admin/ai/image-extraction
 * {
 *   "image_url": "https://example.com/product-image.jpg",
 *   "entity_type": "product",
 *   "notes": "Extract color and size information",
 *   "threadId": "thread_123456789",
 *   "resourceId": "prod_987654321",
 *   "hints": ["focus on color variations", "include size chart"],
 *   "verify": true,
 *   "persist": false,
 *   "defaults": {
 *     "category": "apparel",
 *     "material": "cotton"
 *   }
 * }
 *
 * @example response 200
 * {
 *   "message": "Image processed successfully",
 *   "result": {
 *     "extracted_data": {
 *       "colors": ["red", "blue", "green"],
 *       "sizes": ["S", "M", "L", "XL"],
 *       "material": "cotton",
 *       "category": "apparel"
 *     },
 *     "status": "completed",
 *     "metadata": {
 *       "processing_time": "2.5s",
 *       "confidence_score": 0.95
 *     }
 *   }
 * }
 *
 * @example response 201
 * {
 *   "message": "Image processed and records created",
 *   "result": {
 *     "extracted_data": {
 *       "colors": ["red", "blue", "green"],
 *       "sizes": ["S", "M", "L", "XL"],
 *       "material": "cotton",
 *       "category": "apparel"
 *     },
 *     "status": "persisted",
 *     "metadata": {
 *       "processing_time": "3.1s",
 *       "confidence_score": 0.92,
 *       "created_records": [
 *         {
 *           "id": "variant_123456789",
 *           "type": "product_variant"
 *         },
 *         {
 *           "id": "option_987654321",
 *           "type": "product_option"
 *         }
 *       ]
 *     }
 *   }
 * }
 *
 * @example response 400
 * {
 *   "message": "Invalid image_url format, entity_type is required"
 * }
 *
 * @example response 500
 * {
 *   "message": "Image extraction failed; Unable to process image at provided URL"
 * }
 */
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { MedusaError } from "@medusajs/framework/utils";
import { AdminImageExtractionReq, AdminImageExtractionReqType } from "./validators";
import { imageExtractionMedusaWorkflow } from "../../../../workflows/ai/image-extraction";
import { extractAndCreateInventoryWorkflow } from "../../../../workflows/ai/extract-and-create-inventory";

export const POST = async (
  req: MedusaRequest<AdminImageExtractionReqType>,
  res: MedusaResponse
) => {
  try {
    // Validate input from JSON body
    const parsed = AdminImageExtractionReq.safeParse(
      (req as any).validatedBody || (req.body as AdminImageExtractionReqType)
    );
    if (!parsed.success) {
      const message = parsed.error.errors.map((e) => e.message).join(", ");
      throw new MedusaError(MedusaError.Types.INVALID_DATA, message || "Invalid request body");
    }
    const body = parsed.data;

    // Conditionally run composite workflow for persistence
    if (body.persist) {
      const { result, errors } = await extractAndCreateInventoryWorkflow(req.scope).run({
        input: {
          image_url: body.image_url,
          entity_type: body.entity_type,
          notes: body.notes,
          threadId: body.threadId,
          resourceId: body.resourceId,
          hints: body.hints,
          verify: body.verify,
          persist: true,
          defaults: body.defaults,
        },
      })

      if (errors.length) {
        const msg = errors.map((e) => e.error?.message).filter(Boolean).join("; ")
        throw new MedusaError(MedusaError.Types.UNEXPECTED_STATE, msg || "Extraction + persistence failed")
      }

      return res.status(201).json({
        message: "Image processed and records created",
        result,
      })
    } else {
      const { result, errors } = await imageExtractionMedusaWorkflow(req.scope).run({
        input: {
          image_url: body.image_url,
          entity_type: body.entity_type,
          notes: body.notes,
          threadId: body.threadId,
          resourceId: body.resourceId,
          hints: body.hints,
          verify: body.verify,
          defaults: body.defaults,
        },
      })

      if (errors.length) {
        const msg = errors.map((e) => e.error?.message).filter(Boolean).join("; ")
        throw new MedusaError(MedusaError.Types.UNEXPECTED_STATE, msg || "Image extraction failed")
      }

      return res.status(200).json({
        message: "Image processed successfully",
        result,
      })
    }
  } catch (e) {
    const err = e as Error;
    if (e instanceof MedusaError) {
      const status = e.type === MedusaError.Types.INVALID_DATA ? 400 : 500;
      return res.status(status).json({ message: err.message });
    }
    return res.status(500).json({ message: err.message || "Unexpected error" });
  }
};
