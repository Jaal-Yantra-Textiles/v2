/**
 * @file Admin API route for geocoding person addresses
 * @description Provides an endpoint to trigger background geocoding of all person addresses missing coordinates
 * @module API/Admin/Persons
 */

/**
 * @typedef {Object} GeocodeAddressesResponse
 * @property {Object} summary - Summary of the geocoding operation
 * @property {string} transaction_id - Unique identifier for the background transaction
 */

/**
 * Trigger background geocoding for all person addresses missing coordinates
 * @route POST /admin/persons/geocode-addresses
 * @group Person - Operations related to person management
 * @returns {GeocodeAddressesResponse} 202 - Accepted request with transaction details
 * @throws {MedusaError} 401 - Unauthorized access
 * @throws {MedusaError} 500 - Internal server error when initiating the workflow
 *
 * @example request
 * POST /admin/persons/geocode-addresses
 * Content-Type: application/json
 *
 * @example response 202
 * {
 *   "summary": {
 *     "processed": 150,
 *     "successful": 145,
 *     "failed": 5,
 *     "skipped": 0
 *   },
 *   "transaction_id": "txn_987654321"
 * }
 */
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { backfillAllGeocodesWorkflow } from "../../../../workflows/persons/backfill-all-geocodes"

/**
 * @swagger
 * /admin/persons/geocode-addresses:
 *   post:
 *     summary: Backfill all missing geocodes
 *     description: Triggers a background workflow to geocode all person addresses that are missing coordinates.
 *     tags:
 *       - Person
 *     responses:
 *       202:
 *         description: Accepted
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 transaction_id:
 *                   type: string
 *                 summary:
 *                   type: object
 */
export const POST = async (
  req: MedusaRequest,
  res: MedusaResponse
) => {
  const workflow = backfillAllGeocodesWorkflow(req.scope)
  const { result, transaction } = await workflow.run({
    input: {},
  })

  res.status(202).json({ summary: result, transaction_id: transaction.transactionId })
}
