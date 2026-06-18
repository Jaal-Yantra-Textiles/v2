/**
 * @file Admin API route for generating product descriptions using AI
 * @description Provides an endpoint to generate product titles and descriptions based on product images and optional hints
 * @module API/Admin/Products
 */

/**
 * @typedef {Object} GenerateDescriptionInput
 * @property {string} imageUrl - URL of the product image to analyze
 * @property {string} [hint] - Optional hint or description prompt for the AI
 * @property {string} [notes] - Alternative field for hint (deprecated, use hint instead)
 * @property {Object} [productData] - Additional product metadata to inform description generation
 */

/**
 * @typedef {Object} GenerateDescriptionResponse
 * @property {string} product_id - The ID of the product being described
 * @property {string} title - AI-generated product title
 * @property {string} description - AI-generated product description
 */

/**
 * Generate product description using AI analysis
 * @route POST /admin/products/:id/generateDescription
 * @group Product - Operations related to products
 * @param {string} id.path.required - The product ID
 * @param {GenerateDescriptionInput} request.body.required - Input data for description generation
 * @returns {GenerateDescriptionResponse} 200 - Generated product title and description
 * @throws {MedusaError} 400 - Invalid input data (missing imageUrl)
 * @throws {MedusaError} 401 - Unauthorized
 * @throws {MedusaError} 404 - Product not found
 * @throws {MedusaError} 500 - AI generation workflow error
 *
 * @example request
 * POST /admin/products/prod_123456789/generateDescription
 * {
 *   "imageUrl": "https://example.com/products/tshirt-blue.jpg",
 *   "hint": "Comfortable cotton t-shirt with unique print design",
 *   "productData": {
 *     "category": "apparel",
 *     "material": "cotton",
 *     "color": "blue"
 *   }
 * }
 *
 * @example response 200
 * {
 *   "product_id": "prod_123456789",
 *   "title": "Premium Blue Cotton T-Shirt with Unique Print",
 *   "description": "This comfortable blue t-shirt is made from 100% premium cotton, featuring a unique print design that stands out. Perfect for casual wear with a stylish touch. Machine washable and available in multiple sizes."
 * }
 *
 * @example request (minimal)
 * POST /admin/products/prod_987654321/generateDescription
 * {
 *   "imageUrl": "https://example.com/products/mug.jpg"
 * }
 *
 * @example response 200 (minimal)
 * {
 *   "product_id": "prod_987654321",
 *   "title": "Classic Ceramic Coffee Mug",
 *   "description": "A durable ceramic mug perfect for your daily coffee or tea. Features a comfortable handle and generous capacity. Dishwasher and microwave safe."
 * }
 */
import { MedusaRequest, MedusaResponse } from "@medusajs/framework"
import { GenerateDescriptionValidator } from "./validators"
import { describeProductImageWorkflow } from "../../../../../workflows/ai/describe-product-image"
import { generateProductDescriptionWorkflow } from "../../../../../workflows/products/gen-ai-desc"
import { MedusaError } from "@medusajs/utils"

/**
 * Generate a product title + description from an image, trying providers in
 * priority order and falling through on failure:
 *
 *   1. Configured AI platform for role `ai_product_description` (e.g. DashScope
 *      / Qwen-VL set in Settings → External Platforms). The admin's chosen
 *      default; ~15s and the cheapest reliable path.
 *   2. OpenRouter FREE vision models (filtered to real vision→text models, so
 *      the chain no longer wastes time on audio/image-generator models).
 *
 * First success wins. If every provider fails, surface one aggregated error
 * naming what was tried, so the cause is visible instead of a bare 504/500.
 */
export const POST = async (
  req: MedusaRequest<GenerateDescriptionValidator>,
  res: MedusaResponse
) => {
  const { id } = req.params

  const body = req.validatedBody
  if (!body?.imageUrl) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "imageUrl is required"
    )
  }

  const hint = body.hint ?? body.notes
  const attempts: string[] = []

  // 1) Configured AI platform (DashScope / role=ai_product_description).
  try {
    const { result } = await describeProductImageWorkflow(req.scope).run({
      input: { imageUrl: body.imageUrl, hint },
    })
    const r = result as {
      title: string
      description: string
      provider_platform_id: string
    }
    res.status(200).json({
      product_id: id,
      title: r.title,
      description: r.description,
      provider: `platform:${r.provider_platform_id}`,
    })
    return
  } catch (e: any) {
    attempts.push(`configured-platform: ${e?.message || e}`)
  }

  // 2) OpenRouter free vision models (skips audio/image-gen models now).
  if (process.env.OPENROUTER_API_KEY) {
    try {
      const { result, errors } = await generateProductDescriptionWorkflow(
        req.scope
      ).run({
        input: {
          imageUrl: body.imageUrl,
          hint,
          productData: body.productData || {},
        },
      })
      if (errors?.length) {
        throw errors[0]
      }
      const r = result as { title: string; description: string }
      res.status(200).json({
        product_id: id,
        title: r.title,
        description: r.description,
        provider: "openrouter-free-vision",
      })
      return
    } catch (e: any) {
      attempts.push(`openrouter-free-vision: ${e?.message || e}`)
    }
  } else {
    attempts.push("openrouter-free-vision: skipped (OPENROUTER_API_KEY not set)")
  }

  throw new MedusaError(
    MedusaError.Types.UNEXPECTED_STATE,
    `All AI description providers failed. Tried — ${attempts.join(" | ")}`
  )
}
