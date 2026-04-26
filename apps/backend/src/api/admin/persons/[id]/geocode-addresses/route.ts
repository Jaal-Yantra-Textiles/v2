/**
 * @file Admin API route for geocoding person addresses
 * @description Provides an endpoint to trigger geocoding of all addresses for a specific person
 * @module API/Admin/Persons
 */

/**
 * @typedef {Object} GeocodeAddressesInput
 * @property {string} person_id - The ID of the person whose addresses should be geocoded
 */

/**
 * @typedef {Object} GeocodeAddressesResponse
 * @property {Object} summary - Summary of the geocoding operation
 * @property {string} transaction_id - The transaction ID for tracking the background workflow
 */

/**
 * Trigger geocoding for all addresses of a specific person
 * @route POST /admin/persons/{id}/geocode-addresses
 * @group Person - Operations related to persons
 * @param {string} id.path.required - The ID of the person whose addresses should be geocoded
 * @returns {GeocodeAddressesResponse} 202 - Accepted response with transaction details
 * @throws {MedusaError} 400 - Invalid person ID
 * @throws {MedusaError} 401 - Unauthorized
 * @throws {MedusaError} 404 - Person not found
 * @throws {MedusaError} 500 - Internal server error
 *
 * @example request
 * POST /admin/persons/pers_123456789/geocode-addresses
 *
 * @example response 202
 * {
 *   "summary": {
 *     "processed": 5,
 *     "successful": 4,
 *     "failed": 1
 *   },
 *   "transaction_id": "txn_987654321"
 * }
 */
import {
  MedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { geocodeAllAddressesWorkflow } from "../../../../../workflows/persons/geocode-all-addresses"

/**
 * @swagger
 * /admin/persons/geocode-addresses:
 *   post:
 *     summary: Geocode all existing addresses
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
  const { id: person_id } =  req.params;
  const workflow = geocodeAllAddressesWorkflow(req.scope)
  const { result, transaction } = await workflow.run({
    input: { person_id },
  })
  console.log(transaction.getState())
  res.status(202).json({ summary: result, transaction_id: transaction.transactionId })
}
