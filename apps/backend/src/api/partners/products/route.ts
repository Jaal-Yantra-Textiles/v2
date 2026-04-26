/**
 * @file Partner API routes for product management
 * @description Provides endpoints for partners to create products in the JYT Commerce platform
 * @module API/Partners/Products
 */

/**
 * @typedef {Object} PartnerProductInput
 * @property {string} store_id - The ID of the store where the product should be created
 * @property {Object} product - The product data to create
 * @property {string} product.title - The title of the product
 * @property {string} [product.subtitle] - The subtitle of the product
 * @property {string} [product.description] - The description of the product
 * @property {string} [product.handle] - The handle (slug) of the product
 * @property {boolean} [product.is_giftcard] - Whether the product is a gift card
 * @property {string} [product.status] - The status of the product (draft, proposed, published, rejected)
 * @property {string} [product.thumbnail] - The URL of the product thumbnail
 * @property {Object[]} [product.images] - Array of product image URLs
 * @property {Object} [product.variants] - Product variant information
 * @property {Object} [product.options] - Product option information
 * @property {Object} [product.profile] - Shipping profile information
 * @property {Object} [product.collection] - Collection information
 * @property {Object} [product.type] - Product type information
 * @property {Object} [product.tags] - Product tags
 * @property {Object} [product.metadata] - Additional metadata
 */

/**
 * @typedef {Object} PartnerProductResponse
 * @property {string} message - Success message
 * @property {string} partner_id - The ID of the partner who created the product
 * @property {string} store_id - The ID of the store where the product was created
 * @property {Object} product - The created product object
 * @property {string} product.id - The unique identifier of the product
 * @property {string} product.title - The title of the product
 * @property {string} product.subtitle - The subtitle of the product
 * @property {string} product.description - The description of the product
 * @property {string} product.handle - The handle (slug) of the product
 * @property {boolean} product.is_giftcard - Whether the product is a gift card
 * @property {string} product.status - The status of the product
 * @property {string} product.thumbnail - The URL of the product thumbnail
 * @property {Object[]} product.images - Array of product image URLs
 * @property {Object} product.variants - Product variant information
 * @property {Object} product.options - Product option information
 * @property {Object} product.profile - Shipping profile information
 * @property {Object} product.collection - Collection information
 * @property {Object} product.type - Product type information
 * @property {Object} product.tags - Product tags
 * @property {Object} product.metadata - Additional metadata
 * @property {Date} product.created_at - When the product was created
 * @property {Date} product.updated_at - When the product was last updated
 */

/**
 * Create a new product as a partner
 * @route POST /partners/products
 * @group Product - Operations related to products
 * @param {PartnerProductInput} request.body.required - Product data to create
 * @returns {PartnerProductResponse} 201 - Created product object with partner and store information
 * @throws {MedusaError} 401 - Unauthorized - Partner authentication required or no partner associated with this admin
 * @throws {MedusaError} 404 - Not Found - Store not found
 * @throws {MedusaError} 400 - Invalid Data - Store has no default sales channel configured
 *
 * @example request
 * POST /partners/products
 * {
 *   "store_id": "store_123456789",
 *   "product": {
 *     "title": "Premium Wireless Headphones",
 *     "subtitle": "Noise-cancelling with 30-hour battery",
 *     "description": "High-quality wireless headphones with active noise cancellation...",
 *     "handle": "premium-wireless-headphones",
 *     "is_giftcard": false,
 *     "status": "draft",
 *     "thumbnail": "https://example.com/images/headphones-thumb.jpg",
 *     "images": [
 *       "https://example.com/images/headphones-1.jpg",
 *       "https://example.com/images/headphones-2.jpg"
 *     ],
 *     "variants": [...],
 *     "options": [...],
 *     "profile": {...},
 *     "collection": {...},
 *     "type": {...},
 *     "tags": [...],
 *     "metadata": {...}
 *   }
 * }
 *
 * @example response 201
 * {
 *   "message": "Product created",
 *   "partner_id": "partner_987654321",
 *   "store_id": "store_123456789",
 *   "product": {
 *     "id": "prod_1122334455",
 *     "title": "Premium Wireless Headphones",
 *     "subtitle": "Noise-cancelling with 30-hour battery",
 *     "description": "High-quality wireless headphones with active noise cancellation...",
 *     "handle": "premium-wireless-headphones",
 *     "is_giftcard": false,
 *     "status": "draft",
 *     "thumbnail": "https://example.com/images/headphones-thumb.jpg",
 *     "images": [
 *       "https://example.com/images/headphones-1.jpg",
 *       "https://example.com/images/headphones-2.jpg"
 *     ],
 *     "variants": [...],
 *     "options": [...],
 *     "profile": {...},
 *     "collection": {...},
 *     "type": {...},
 *     "tags": [...],
 *     "metadata": {...},
 *     "created_at": "2023-11-15T14:30:00Z",
 *     "updated_at": "2023-11-15T14:30:00Z"
 *   }
 * }
 */
import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError, ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { PartnerCreateProductReq } from "./validators"
import { createProductsWorkflow } from "@medusajs/medusa/core-flows"
import { getPartnerFromAuthContext } from "../helpers"

export const POST = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  if (!req.auth_context?.actor_id) {
    throw new MedusaError(MedusaError.Types.UNAUTHORIZED, "Partner authentication required")
  }

  const partner = await getPartnerFromAuthContext(req.auth_context, req.scope)
  if (!partner) {
    throw new MedusaError(MedusaError.Types.UNAUTHORIZED, "No partner associated with this admin")
  }

  const body = PartnerCreateProductReq.parse(req.body)

  // Fetch target store and determine the sales channel to associate the product with
  const storeService = req.scope.resolve(Modules.STORE)
  const [store] = await storeService.listStores({ id: body.store_id })
  if (!store) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, `Store ${body.store_id} not found`)
  }
  if (!store.default_sales_channel_id) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `Store ${body.store_id} has no default sales channel configured`
    )
  }

  // Ensure product is associated to the store's default sales channel
  const productInput = {
    ...body.product,
    title: body.product.title || "",
    sales_channels: [
      {
        id: store.default_sales_channel_id,
      },
    ],
  }

  const { result } = await createProductsWorkflow(req.scope).run({
    input: {
      products: [productInput],
    },
  })

  const created = result?.[0]

  return res.status(201).json({
    message: "Product created",
    partner_id: partner.id,
    store_id: store.id,
    product: created,
  })
}
