/**
 * @file Admin API route for syncing products to Etsy
 * @description Provides endpoints for syncing products from JYT Commerce to Etsy marketplace
 * @module API/Admin/EtsySync
 */

/**
 * @typedef {Object} AdminSyncProductsToEtsyReq
 * @property {string[]} product_ids - Array of product IDs to sync to Etsy
 * @property {string} etsy_account_id - The Etsy account ID to sync products to
 */

/**
 * @typedef {Object} EtsySyncResponse
 * @property {string} transaction_id - The unique transaction ID for the sync operation
 * @property {Object} summary - Summary of the sync operation results
 */

/**
 * Sync products to Etsy marketplace
 * @route POST /admin/products/etsy-sync
 * @group Etsy - Operations related to Etsy marketplace integration
 * @param {AdminSyncProductsToEtsyReq} request.body.required - Product sync data
 * @returns {EtsySyncResponse} 202 - Accepted sync operation response
 * @throws {MedusaError} 400 - Invalid input data (missing product_ids or etsy_account_id)
 * @throws {MedusaError} 401 - Unauthorized
 * @throws {MedusaError} 500 - Internal server error during sync process
 *
 * @example request
 * POST /admin/products/etsy-sync
 * {
 *   "product_ids": ["prod_01H1YZ7X3K5X4X5X6X7X8X9X", "prod_01H1YZ7X3K5X4X5X6X7X8X9Y"],
 *   "etsy_account_id": "etsy_acc_01H1YZ7X3K5X4X5X6X7X8X9Z"
 * }
 *
 * @example response 202
 * {
 *   "transaction_id": "txn_01H1YZ7X3K5X4X5X6X7X8X9A",
 *   "summary": {
 *     "success_count": 2,
 *     "failed_count": 0,
 *     "errors": []
 *   }
 * }
 *
 * @example response 400
 * {
 *   "message": "No products were provided for Etsy sync",
 *   "type": "invalid_data",
 *   "code": "invalid_data"
 * }
 */
import {
  MedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { syncProductsToEtsyWorkflow } from "../../../../workflows/etsy_sync"

export type AdminSyncProductsToEtsyReq = {
  product_ids: string[]
  etsy_account_id: string
}

export const POST = async (
  req: MedusaRequest<AdminSyncProductsToEtsyReq>,
  res: MedusaResponse
) => {
  const { product_ids, etsy_account_id } = req.body || ({} as any)

  if (!product_ids?.length) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "No products were provided for Etsy sync"
    )
  }

  if (!etsy_account_id) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "etsy_account_id is required for Etsy sync"
    )
  }

  const { result, transaction } = await syncProductsToEtsyWorkflow(
    req.scope
  ).run({
    input: {
      product_ids,
      etsy_account_id,
    },
  })

  res.status(202).json({
    transaction_id: transaction.transactionId,
    summary: result,
  })
}
