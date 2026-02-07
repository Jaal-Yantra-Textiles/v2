/**
 * @file Partner API routes for managing store products
 * @description Provides endpoints for listing products in a specific store within the JYT Commerce platform
 * @module API/Partner/StoreProducts
 */

/**
 * @typedef {Object} Product
 * @property {string} id - The unique identifier of the product
 * @property {string} title - The title of the product
 * @property {string} subtitle - The subtitle of the product
 * @property {string} description - The description of the product
 * @property {string} handle - The handle of the product
 * @property {boolean} is_giftcard - Whether the product is a gift card
 * @property {string} status - The status of the product (draft, proposed, published, rejected)
 * @property {string} thumbnail - The URL of the product thumbnail
 * @property {Object} profile - The profile of the product
 * @property {string} profile.id - The unique identifier of the profile
 * @property {string} profile.name - The name of the profile
 * @property {string} profile.type - The type of the profile
 * @property {Object} collection - The collection of the product
 * @property {string} collection.id - The unique identifier of the collection
 * @property {string} collection.title - The title of the collection
 * @property {string} collection.handle - The handle of the collection
 * @property {Object[]} variants - The variants of the product
 * @property {string} variants.id - The unique identifier of the variant
 * @property {string} variants.title - The title of the variant
 * @property {string} variants.sku - The SKU of the variant
 * @property {number} variants.price - The price of the variant
 * @property {number} variants.inventory_quantity - The inventory quantity of the variant
 * @property {Object} variants.options - The options of the variant
 * @property {string} variants.options.id - The unique identifier of the option
 * @property {string} variants.options.value - The value of the option
 * @property {Date} created_at - When the product was created
 * @property {Date} updated_at - When the product was last updated
 */

/**
 * @typedef {Object} ListStoreProductsResponse
 * @property {string} partner_id - The unique identifier of the partner
 * @property {string} store_id - The unique identifier of the store
 * @property {number} count - The number of products in the store
 * @property {Product[]} products - The list of products in the store
 */

/**
 * List products in a specific store
 * @route GET /partners/stores/:id/products
 * @group Store Products - Operations related to store products
 * @param {string} id.path.required - The unique identifier of the store
 * @returns {ListStoreProductsResponse} 200 - List of products in the store
 * @throws {MedusaError} 401 - Unauthorized - Partner authentication required or no partner associated with this admin
 * @throws {MedusaError} 400 - Invalid data - Store id is required in path
 *
 * @example request
 * GET /partners/stores/store_123456789/products
 *
 * @example response 200
 * {
 *   "partner_id": "partner_123456789",
 *   "store_id": "store_123456789",
 *   "count": 2,
 *   "products": [
 *     {
 *       "id": "prod_123456789",
 *       "title": "T-Shirt",
 *       "subtitle": "Cotton T-Shirt",
 *       "description": "A comfortable cotton t-shirt",
 *       "handle": "t-shirt",
 *       "is_giftcard": false,
 *       "status": "published",
 *       "thumbnail": "https://example.com/t-shirt.jpg",
 *       "profile": {
 *         "id": "profile_123456789",
 *         "name": "Clothing",
 *         "type": "default"
 *       },
 *       "collection": {
 *         "id": "collection_123456789",
 *         "title": "Summer Collection",
 *         "handle": "summer-collection"
 *       },
 *       "variants": [
 *         {
 *           "id": "variant_123456789",
 *           "title": "Small",
 *           "sku": "TSHIRT-S",
 *           "price": 1999,
 *           "inventory_quantity": 10,
 *           "options": {
 *             "id": "option_123456789",
 *             "value": "Small"
 *           }
 *         }
 *       ],
 *       "created_at": "2023-01-01T00:00:00Z",
 *       "updated_at": "2023-01-01T00:00:00Z"
 *     },
 *     {
 *       "id": "prod_987654321",
 *       "title": "Jeans",
 *       "subtitle": "Denim Jeans",
 *       "description": "A pair of comfortable denim jeans",
 *       "handle": "jeans",
 *       "is_giftcard": false,
 *       "status": "published",
 *       "thumbnail": "https://example.com/jeans.jpg",
 *       "profile": {
 *         "id": "profile_123456789",
 *         "name": "Clothing",
 *         "type": "default"
 *       },
 *       "collection": {
 *         "id": "collection_123456789",
 *         "title": "Summer Collection",
 *         "handle": "summer-collection"
 *       },
 *       "variants": [
 *         {
 *           "id": "variant_987654321",
 *           "title": "Medium",
 *           "sku": "JEANS-M",
 *           "price": 3999,
 *           "inventory_quantity": 5,
 *           "options": {
 *             "id": "option_987654321",
 *             "value": "Medium"
 *           }
 *         }
 *       ],
 *       "created_at": "2023-01-01T00:00:00Z",
 *       "updated_at": "2023-01-01T00:00:00Z"
 *     }
 *   ]
 * }
 */
import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError, ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { getPartnerFromAuthContext } from "../../../helpers"
import listStoreProductsWorkflow from "../../../../../workflows/partner/list-store-products"

export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const actorId = req.auth_context?.actor_id
  if (!actorId) {
    throw new MedusaError(MedusaError.Types.UNAUTHORIZED, "Partner authentication required")
  }

  const partner = await getPartnerFromAuthContext(req.auth_context, req.scope)
  if (!partner) {
    throw new MedusaError(MedusaError.Types.UNAUTHORIZED, "No partner associated with this admin")
  }

  const storeId = req.params.id
  if (!storeId) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "Store id is required in path")
  }

  // Enforce ownership: ensure the requested store is linked to this partner
  
  // Delegate product listing to workflow
  const { result: links } = await listStoreProductsWorkflow(req.scope).run({
    input: {
      partnerId: partner.id,
      storeId,
    },
  })

  const products = (links as any[]) || []
  const count = products.length

  return res.status(200).json({
    partner_id: partner.id,
    store_id: storeId,
    count,
    products,
  })
}
