/**
 * @file Admin API routes for managing production runs
 * @description Provides endpoints for creating and listing production runs in the JYT Commerce platform
 * @module API/Admin/ProductionRuns
 */

/**
 * @typedef {Object} AdminCreateProductionRunReq
 * @property {string} design_id.required - The ID of the design to be produced
 * @property {string} [partner_id] - The ID of the production partner
 * @property {number} quantity.required - The quantity to be produced
 * @property {string} product_id.required - The ID of the product
 * @property {string} variant_id.required - The ID of the product variant
 * @property {string} [order_id] - The ID of the associated order
 * @property {string} [order_line_item_id] - The ID of the associated order line item
 * @property {Object} [metadata] - Additional metadata for the production run
 */

/**
 * @typedef {Object} ProductionRunResponse
 * @property {string} id - The unique identifier of the production run
 * @property {string} design_id - The ID of the design
 * @property {string} partner_id - The ID of the production partner
 * @property {number} quantity - The quantity to be produced
 * @property {string} product_id - The ID of the product
 * @property {string} variant_id - The ID of the product variant
 * @property {string} order_id - The ID of the associated order
 * @property {string} order_line_item_id - The ID of the associated order line item
 * @property {Object} metadata - Additional metadata
 * @property {string} status - The status of the production run
 * @property {Date} created_at - When the production run was created
 * @property {Date} updated_at - When the production run was last updated
 */

/**
 * Create a new production run
 * @route POST /admin/production-runs
 * @group ProductionRun - Operations related to production runs
 * @param {AdminCreateProductionRunReq} request.body.required - Production run data to create
 * @returns {Object} 201 - Created production run object
 * @throws {MedusaError} 400 - Invalid input data
 * @throws {MedusaError} 401 - Unauthorized
 * @throws {MedusaError} 500 - Failed to create production run
 *
 * @example request
 * POST /admin/production-runs
 * {
 *   "design_id": "design_123456789",
 *   "partner_id": "partner_987654321",
 *   "quantity": 100,
 *   "product_id": "prod_1122334455",
 *   "variant_id": "variant_5544332211",
 *   "order_id": "order_9988776655",
 *   "order_line_item_id": "item_5566778899",
 *   "metadata": {
 *     "priority": "high",
 *     "notes": "Urgent production"
 *   }
 * }
 *
 * @example response 201
 * {
 *   "production_run": {
 *     "id": "run_123456789",
 *     "design_id": "design_123456789",
 *     "partner_id": "partner_987654321",
 *     "quantity": 100,
 *     "product_id": "prod_1122334455",
 *     "variant_id": "variant_5544332211",
 *     "order_id": "order_9988776655",
 *     "order_line_item_id": "item_5566778899",
 *     "metadata": {
 *       "priority": "high",
 *       "notes": "Urgent production"
 *     },
 *     "status": "pending",
 *     "created_at": "2023-01-01T00:00:00Z",
 *     "updated_at": "2023-01-01T00:00:00Z"
 *   }
 * }
 */

/**
 * List production runs with pagination and filtering
 * @route GET /admin/production-runs
 * @group ProductionRun - Operations related to production runs
 * @param {number} [offset=0] - Pagination offset
 * @param {number} [limit=20] - Number of items to return
 * @param {string} [design_id] - Filter by design ID
 * @param {string} [status] - Filter by status
 * @param {string} [partner_id] - Filter by partner ID
 * @param {string} [parent_run_id] - Filter by parent run ID
 * @returns {Object} 200 - Paginated list of production runs
 * @throws {MedusaError} 401 - Unauthorized
 * @throws {MedusaError} 500 - Internal server error
 *
 * @example request
 * GET /admin/production-runs?offset=0&limit=10&status=pending
 *
 * @example response 200
 * {
 *   "production_runs": [
 *     {
 *       "id": "run_123456789",
 *       "design_id": "design_123456789",
 *       "partner_id": "partner_987654321",
 *       "quantity": 100,
 *       "product_id": "prod_1122334455",
 *       "variant_id": "variant_5544332211",
 *       "order_id": "order_9988776655",
 *       "order_line_item_id": "item_5566778899",
 *       "metadata": {
 *         "priority": "high"
 *       },
 *       "status": "pending",
 *       "created_at": "2023-01-01T00:00:00Z",
 *       "updated_at": "2023-01-01T00:00:00Z"
 *     }
 *   ],
 *   "count": 50,
 *   "offset": 0,
 *   "limit": 10
 * }
 */
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"

import {
  createProductionRunWorkflow,
} from "../../../workflows/production-runs/create-production-run"

import type { AdminCreateProductionRunReq } from "./validators"

export const POST = async (
  req: MedusaRequest<AdminCreateProductionRunReq>,
  res: MedusaResponse
) => {
  const body = (req as any).validatedBody || req.body

  const { result, errors } = await createProductionRunWorkflow(req.scope).run({
    input: {
      design_id: body.design_id,
      partner_id: body.partner_id ?? null,
      quantity: body.quantity,
      product_id: body.product_id,
      variant_id: body.variant_id,
      order_id: body.order_id,
      order_line_item_id: body.order_line_item_id,
      metadata: body.metadata,
    },
  })

  if (errors?.length) {
    throw new MedusaError(
      MedusaError.Types.UNEXPECTED_STATE,
      `Failed to create production run: ${errors
        .map((e: any) => e?.error?.message || String(e))
        .join(", ")}`
    )
  }

  return res.status(201).json({ production_run: result })
}

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const q = req.query as any
  const limit = Number(q.limit) || 20
  const offset = Number(q.offset) || 0

  const filters: any = {}
  if (q.design_id) {
    filters.design_id = q.design_id
  }
  if (q.status) {
    filters.status = q.status
  }
  if (q.partner_id) {
    filters.partner_id = q.partner_id
  }
  if (q.parent_run_id) {
    filters.parent_run_id = q.parent_run_id
  }

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  const { data: runs, metadata } = await query.graph({
    entity: "production_runs",
    fields: ["*"],
    filters,
    pagination: { skip: offset, take: limit },
  })

  const list = runs || []

  return res.status(200).json({
    production_runs: list,
    count: (metadata as any)?.count ?? list.length,
    limit,
    offset,
  })
}
