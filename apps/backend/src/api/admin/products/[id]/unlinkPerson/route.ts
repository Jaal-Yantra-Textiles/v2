/**
 * @file Admin API route for unlinking a person from a product
 * @description Provides an endpoint to remove the association between a product and a person in the JYT Commerce platform
 * @module API/Admin/Products
 */

/**
 * @typedef {Object} UnlinkPersonInput
 * @property {string} personId - The ID of the person to unlink from the product
 */

/**
 * @typedef {Object} ProductResponse
 * @property {string} id - The unique identifier of the product
 * @property {string} title - The title of the product
 * @property {string} subtitle - The subtitle of the product
 * @property {string} description - The description of the product
 * @property {string} handle - The handle of the product
 * @property {boolean} is_giftcard - Whether the product is a gift card
 * @property {string} status - The status of the product (draft, proposed, published, rejected)
 * @property {string[]} images - Array of image URLs associated with the product
 * @property {string[]} thumbnail - The thumbnail URL of the product
 * @property {Object} profile - The profile of the product
 * @property {string} profile.name - The name of the product profile
 * @property {string} profile.description - The description of the product profile
 * @property {string} profile.type - The type of the product profile
 * @property {string} profile.id - The ID of the product profile
 * @property {Date} created_at - When the product was created
 * @property {Date} updated_at - When the product was last updated
 * @property {Date} deleted_at - When the product was deleted (if applicable)
 * @property {Object} metadata - Additional metadata associated with the product
 * @property {Object} variants - The variants of the product
 * @property {Object} options - The options of the product
 * @property {Object} tags - The tags associated with the product
 * @property {Object} type - The type of the product
 * @property {Object} collection - The collection the product belongs to
 * @property {Object} sales_channels - The sales channels the product is available in
 * @property {Object} categories - The categories the product belongs to
 */

/**
 * Unlink a person from a product
 * @route POST /admin/products/:id/unlinkPerson
 * @group Product - Operations related to products
 * @param {string} id.path.required - The ID of the product to unlink the person from
 * @param {UnlinkPersonInput} request.body.required - The person ID to unlink
 * @returns {Object} 200 - The updated product object
 * @throws {MedusaError} 400 - Invalid input data
 * @throws {MedusaError} 401 - Unauthorized
 * @throws {MedusaError} 404 - Product or person not found
 * @throws {MedusaError} 500 - Internal server error
 *
 * @example request
 * POST /admin/products/prod_123456789/unlinkPerson
 * {
 *   "personId": "person_987654321"
 * }
 *
 * @example response 200
 * {
 *   "product": {
 *     "id": "prod_123456789",
 *     "title": "Example Product",
 *     "subtitle": "A great product",
 *     "description": "This is an example product description.",
 *     "handle": "example-product",
 *     "is_giftcard": false,
 *     "status": "published",
 *     "images": ["https://example.com/image1.jpg", "https://example.com/image2.jpg"],
 *     "thumbnail": "https://example.com/thumbnail.jpg",
 *     "profile": {
 *       "name": "Default Product Profile",
 *       "description": "Default profile for products",
 *       "type": "default",
 *       "id": "pp_123456789"
 *     },
 *     "created_at": "2023-01-01T00:00:00Z",
 *     "updated_at": "2023-01-02T00:00:00Z",
 *     "deleted_at": null,
 *     "metadata": {},
 *     "variants": [],
 *     "options": [],
 *     "tags": [],
 *     "type": {},
 *     "collection": {},
 *     "sales_channels": [],
 *     "categories": []
 *   }
 * }
 */
import { MedusaRequest, MedusaResponse } from "@medusajs/framework"
import { UnlinkPersonValidator } from "../linkPerson/validators"
import { unlinkProductFromPersonWorkflow } from "../../../../../workflows/products/link-unlink-products-with-people"
import { refetchProduct } from "../linkPerson/helper"

export const POST = async (
  req: MedusaRequest<UnlinkPersonValidator>,
  res: MedusaResponse
) => {
  const { id } = req.params
  const { personId } = req.validatedBody

  const { errors } = await unlinkProductFromPersonWorkflow(req.scope).run({
    input: { productId: id, personId },
  })

  if (errors.length) {
    console.warn("Error reported at", errors)
    throw errors
  }

  const product = await refetchProduct(id, req.scope)
  res.status(200).json({ product })
}
