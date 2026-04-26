/**
 * @file Admin API routes for managing stores
 * @description Provides endpoints for creating stores in the JYT Commerce platform
 * @module API/Admin/Stores
 */

/**
 * @typedef {Object} CreateStoreRequest
 * @property {string} name - The name of the store
 * @property {string} [description] - Optional description of the store
 * @property {string} [currency_code] - The currency code for the store (e.g., "USD", "EUR")
 * @property {string} [default_sales_channel_id] - The default sales channel ID for the store
 * @property {string} [default_region_id] - The default region ID for the store
 * @property {string} [swap_link_template] - The template for swap links
 * @property {string} [payment_link_template] - The template for payment links
 * @property {string} [invite_link_template] - The template for invite links
 * @property {Object} [metadata] - Additional metadata for the store
 */

/**
 * @typedef {Object} StoreResponse
 * @property {string} id - The unique identifier of the store
 * @property {string} name - The name of the store
 * @property {string} [description] - Optional description of the store
 * @property {string} currency_code - The currency code for the store
 * @property {string} default_sales_channel_id - The default sales channel ID for the store
 * @property {string} default_region_id - The default region ID for the store
 * @property {string} swap_link_template - The template for swap links
 * @property {string} payment_link_template - The template for payment links
 * @property {string} invite_link_template - The template for invite links
 * @property {Object} metadata - Additional metadata for the store
 * @property {Date} created_at - When the store was created
 * @property {Date} updated_at - When the store was last updated
 */

/**
 * Create a new store
 * @route POST /admin/stores
 * @group Store - Operations related to stores
 * @param {CreateStoreRequest} request.body.required - Store data to create
 * @returns {Object} 201 - Created store object
 * @throws {MedusaError} 400 - Invalid input data
 * @throws {MedusaError} 401 - Unauthorized
 * @throws {MedusaError} 500 - Internal server error
 *
 * @example request
 * POST /admin/stores
 * {
 *   "name": "JYT Commerce Store",
 *   "description": "Main store for JYT Commerce",
 *   "currency_code": "USD",
 *   "default_sales_channel_id": "sc_123456789",
 *   "default_region_id": "reg_123456789",
 *   "swap_link_template": "swap/{cart_id}",
 *   "payment_link_template": "payment/{cart_id}",
 *   "invite_link_template": "invite/{invite_id}",
 *   "metadata": {
 *     "custom_field": "custom_value"
 *   }
 * }
 *
 * @example response 201
 * {
 *   "store": {
 *     "id": "store_123456789",
 *     "name": "JYT Commerce Store",
 *     "description": "Main store for JYT Commerce",
 *     "currency_code": "USD",
 *     "default_sales_channel_id": "sc_123456789",
 *     "default_region_id": "reg_123456789",
 *     "swap_link_template": "swap/{cart_id}",
 *     "payment_link_template": "payment/{cart_id}",
 *     "invite_link_template": "invite/{invite_id}",
 *     "metadata": {
 *       "custom_field": "custom_value"
 *     },
 *     "created_at": "2023-01-01T00:00:00Z",
 *     "updated_at": "2023-01-01T00:00:00Z"
 *   },
 *   "message": "Store created successfully"
 * }
 */
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { createStoresWorkflow } from "@medusajs/medusa/core-flows";
import { CreateStoreRequest } from "./validators";



// POST /admin/stores - Create a new store
export async function POST(
  req: MedusaRequest<CreateStoreRequest>,
  res: MedusaResponse
) {
  const storeData = req.validatedBody;

    // Use the createStoresWorkflow to create the store
    const { result } = await createStoresWorkflow(req.scope).run({
      input: {
        stores: [storeData]
      }
    });

    const createdStore = result[0];

    res.status(201).json({
      store: createdStore,
      message: "Store created successfully"
    });
}
