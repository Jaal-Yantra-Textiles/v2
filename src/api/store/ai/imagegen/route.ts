/**
 * @file Store API route for AI image generation
 * @description Provides endpoints for generating AI-powered design images in the JYT Commerce platform
 * @module API/Store/AI/ImageGen
 */

/**
 * @typedef {Object} StoreGenerateAiImageReq
 * @property {string} prompt - The text prompt describing the desired image
 * @property {string} [style] - Optional style descriptor for the image generation
 * @property {number} [width=512] - Width of the generated image in pixels
 * @property {number} [height=512] - Height of the generated image in pixels
 * @property {string} [format=png] - Output format of the image (png, jpeg, webp)
 * @property {number} [quality=0.8] - Quality of the generated image (0.1 to 1.0)
 */

/**
 * @typedef {Object} AiImageGenerationResult
 * @property {string} id - Unique identifier for the generation
 * @property {string} customer_id - ID of the customer who requested the generation
 * @property {string} prompt - The original prompt used for generation
 * @property {string} image_url - URL to access the generated image
 * @property {string} status - Current status of the generation (pending, completed, failed)
 * @property {Date} created_at - When the generation was requested
 * @property {Date} completed_at - When the generation was completed
 * @property {Object} metadata - Additional generation metadata
 * @property {string} metadata.style - The style used for generation
 * @property {number} metadata.width - Width of the generated image
 * @property {number} metadata.height - Height of the generated image
 * @property {string} metadata.format - Output format of the image
 * @property {number} metadata.quality - Quality setting used
 */

/**
 * Generate an AI-powered design image
 * @route POST /store/ai/imagegen
 * @group AI - Operations related to AI-powered features
 * @param {StoreGenerateAiImageReq} request.body.required - Image generation parameters
 * @returns {Object} 200 - AI image generation result
 * @throws {MedusaError} 401 - Customer authentication required
 * @throws {MedusaError} 400 - Invalid input parameters
 * @throws {MedusaError} 500 - Image generation failed
 *
 * @example request
 * POST /store/ai/imagegen
 * {
 *   "prompt": "A futuristic sneaker design with neon accents",
 *   "style": "cyberpunk",
 *   "width": 1024,
 *   "height": 1024,
 *   "format": "png",
 *   "quality": 0.9
 * }
 *
 * @example response 200
 * {
 *   "generation": {
 *     "id": "gen_123456789abc",
 *     "customer_id": "cust_987654321xyz",
 *     "prompt": "A futuristic sneaker design with neon accents",
 *     "image_url": "https://storage.jytcommerce.com/ai-gen/gen_123456789abc.png",
 *     "status": "completed",
 *     "created_at": "2023-11-15T14:30:22Z",
 *     "completed_at": "2023-11-15T14:31:45Z",
 *     "metadata": {
 *       "style": "cyberpunk",
 *       "width": 1024,
 *       "height": 1024,
 *       "format": "png",
 *       "quality": 0.9
 *     }
 *   }
 * }
 */
import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { StoreGenerateAiImageReq } from "./validators"
import { generateDesignAiImageWorkflow } from "../../../../workflows/ai/generate-design-image"

export const POST = async (
  req: AuthenticatedMedusaRequest<StoreGenerateAiImageReq>,
  res: MedusaResponse
) => {
  const customerId = req.auth_context?.actor_id

  if (!customerId) {
    throw new MedusaError(MedusaError.Types.UNAUTHORIZED, "Customer auth required")
  }

  const { result, errors } = await generateDesignAiImageWorkflow(req.scope).run({
    input: {
      customer_id: customerId,
      ...req.validatedBody,
    },
  })

  if (errors.length) {
    throw errors[0]
  }

  return res.status(200).json({ generation: result })
}
