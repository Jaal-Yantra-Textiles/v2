/**
 * @file Admin API route for starting dispatch of production runs
 * @description Provides an endpoint to initiate the dispatch workflow for a specific production run
 * @module API/Admin/ProductionRuns
 */

/**
 * @typedef {Object} AdminStartDispatchProductionRunReq
 * @property {string} production_run_id - The ID of the production run to dispatch
 */

/**
 * @typedef {Object} StartDispatchResponse
 * @property {string} transaction_id - The ID of the transaction created for the dispatch workflow
 */

/**
 * Start dispatch workflow for a production run
 * @route POST /admin/production-runs/:id/start-dispatch
 * @group ProductionRun - Operations related to production runs
 * @param {string} id.path.required - The ID of the production run to dispatch
 * @returns {StartDispatchResponse} 202 - Dispatch workflow initiated successfully
 * @throws {MedusaError} 400 - Invalid production run ID
 * @throws {MedusaError} 401 - Unauthorized
 * @throws {MedusaError} 404 - Production run not found
 * @throws {MedusaError} 500 - Internal server error during dispatch workflow initiation
 *
 * @example request
 * POST /admin/production-runs/prun_123456789/start-dispatch
 *
 * @example response 202
 * {
 *   "transaction_id": "txn_987654321"
 * }
 */
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import {
  dispatchProductionRunWorkflow,
} from "../../../../../workflows/production-runs/dispatch-production-run"
import type { AdminStartDispatchProductionRunReq } from "../../validators"

export const POST = async (
  req: MedusaRequest<AdminStartDispatchProductionRunReq>,
  res: MedusaResponse
) => {
  const id = req.params.id

  const { transaction } = await dispatchProductionRunWorkflow(req.scope).run({
    input: {
      production_run_id: id,
    },
  })

  return res.status(202).json({ transaction_id: transaction.transactionId })
}
