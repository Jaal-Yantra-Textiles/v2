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
