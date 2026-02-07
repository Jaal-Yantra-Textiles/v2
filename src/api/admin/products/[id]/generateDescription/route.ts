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
import { generateProductDescriptionWorkflow } from "../../../../../workflows/products/gen-ai-desc"
import { MedusaError } from "@medusajs/utils"

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

  const { result, errors } = await generateProductDescriptionWorkflow(req.scope).run({
    input: {
      imageUrl: body.imageUrl,
      hint,
      productData: body.productData || {},
    },
  })

  if (errors.length) {
    // Surface first error for simplicity
    throw errors[0]
  }

  // result is the workflow response from Mastra validation step
  // Ensure shape contains title and description
  const { title, description } = result as { title: string; description: string }

  res.status(200).json({
    product_id: id,
    title,
    description,
  })
}
