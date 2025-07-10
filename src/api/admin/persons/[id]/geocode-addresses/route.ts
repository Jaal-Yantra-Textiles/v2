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
