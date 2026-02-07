/**
 * @file Admin API route for linking a person to a product
 * @description Provides an endpoint to associate a person with a product in the JYT Commerce platform
 * @module API/Admin/Products
 */

/**
 * @typedef {Object} LinkPersonInput
 * @property {string} personId.required - The ID of the person to link to the product
 */

/**
 * @typedef {Object} ProductResponse
 * @property {string} id - The unique identifier of the product
 * @property {string} title - The title of the product
 * @property {string} subtitle - The subtitle of the product
 * @property {string} description - The description of the product
 * @property {string} handle - The handle of the product
 * @property {boolean} is_giftcard - Whether the product is a gift card
 * @property {string} status - The status of the product
 * @property {string} thumbnail - The URL of the product thumbnail
 * @property {Object} profile - The profile of the product
 * @property {string} profile.id - The ID of the profile
 * @property {string} profile.name - The name of the profile
 * @property {string} profile.type - The type of the profile
 * @property {Object[]} images - The images of the product
 * @property {string} images.url - The URL of the image
 * @property {Object[]} options - The options of the product
 * @property {string} options.id - The ID of the option
 * @property {string} options.title - The title of the option
 * @property {Object[]} variants - The variants of the product
 * @property {string} variants.id - The ID of the variant
 * @property {string} variants.title - The title of the variant
 * @property {number} variants.price - The price of the variant
 * @property {number} variants.inventory_quantity - The inventory quantity of the variant
 * @property {Object[]} tags - The tags of the product
 * @property {string} tags.id - The ID of the tag
 * @property {string} tags.value - The value of the tag
 * @property {Object[]} type - The type of the product
 * @property {string} type.id - The ID of the type
 * @property {string} type.value - The value of the type
 * @property {Object[]} collection - The collection of the product
 * @property {string} collection.id - The ID of the collection
 * @property {string} collection.title - The title of the collection
 * @property {Date} created_at - When the product was created
 * @property {Date} updated_at - When the product was last updated
 * @property {Object[]} people - The people linked to the product
 * @property {string} people.id - The ID of the person
 * @property {string} people.name - The name of the person
 * @property {string} people.role - The role of the person
 */

/**
 * Link a person to a product
 * @route POST /admin/products/:id/linkPerson
 * @group Product - Operations related to products
 * @param {string} id.path.required - The ID of the product to link the person to
 * @param {LinkPersonInput} request.body.required - The ID of the person to link to the product
 * @returns {Object} 200 - The updated product object with the linked person
 * @throws {MedusaError} 400 - Invalid input data
 * @throws {MedusaError} 401 - Unauthorized
 * @throws {MedusaError} 404 - Product or person not found
 * @throws {MedusaError} 500 - Internal server error
 *
 * @example request
 * POST /admin/products/prod_123456789/linkPerson
 * {
 *   "personId": "person_987654321"
 * }
 *
 * @example response 200
 * {
 *   "product": {
 *     "id": "prod_123456789",
 *     "title": "Sample Product",
 *     "subtitle": "A sample product for demonstration",
 *     "description": "This is a sample product used for demonstration purposes.",
 *     "handle": "sample-product",
 *     "is_giftcard": false,
 *     "status": "published",
 *     "thumbnail": "https://example.com/sample-product.jpg",
 *     "profile": {
 *       "id": "profile_123456789",
 *       "name": "Default Profile",
 *       "type": "default"
 *     },
 *     "images": [
 *       {
 *         "url": "https://example.com/sample-product.jpg"
 *       }
 *     ],
 *     "options": [
 *       {
 *         "id": "option_123456789",
 *         "title": "Size"
 *       }
 *     ],
 *     "variants": [
 *       {
 *         "id": "variant_123456789",
 *         "title": "Sample Variant",
 *         "price": 1000,
 *         "inventory_quantity": 10
 *       }
 *     ],
 *     "tags": [
 *       {
 *         "id": "tag_123456789",
 *         "value": "sample"
 *       }
 *     ],
 *     "type": {
 *       "id": "type_123456789",
 *       "value": "physical"
 *     },
 *     "collection": {
 *       "id": "collection_123456789",
 *       "title": "Sample Collection"
 *     },
 *     "created_at": "2023-01-01T00:00:00Z",
 *     "updated_at": "2023-01-01T00:00:00Z",
 *     "people": [
 *       {
 *         "id": "person_987654321",
 *         "name": "John Doe",
 *         "role": "designer"
 *       }
 *     ]
 *   }
 * }
 */
import { MedusaRequest, MedusaResponse } from "@medusajs/framework"
import { LinkPersonValidator } from "./validators"
import { linkProductWithPersonWorkflow } from "../../../../../workflows/products/link-unlink-products-with-people"
import { refetchProduct } from "./helper"


export const POST = async (
  req: MedusaRequest<LinkPersonValidator>,
  res: MedusaResponse
) => {
  const { id } = req.params
  const { personId } = req.validatedBody

  const { errors } = await linkProductWithPersonWorkflow(req.scope).run({
    input: { productId: id, personId },
  })

  if (errors.length) {
    console.warn("Error reported at", errors)
    throw errors
  }

  const product = await refetchProduct(id, req.scope)
  res.status(200).json({ product })
}
