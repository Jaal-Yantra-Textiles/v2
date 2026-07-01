import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { z } from "zod"
import { createRunsForDesignOrder } from "../../../../../../workflows/designs/create-runs-for-design-order"

/**
 * POST /admin/orders/:id/design/produce
 *
 * #826 S3a — produce a design commissioning order: fan out one production_run
 * per design line item and COLLATE them into ONE kind=design work-order (a line
 * per design), so the partner sees one order with many designs instead of N
 * separate work-orders.
 *
 * Optional `partner_id` commits the work to a partner (runs are born
 * sent_to_partner, so the collated work-order is scoped/visible to them).
 * Idempotent — re-producing resolves the same work-order.
 */
const ProduceBody = z.object({
  partner_id: z.string().optional(),
})

export const POST = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
): Promise<void> => {
  const { id } = req.params
  const { partner_id } = ProduceBody.parse(
    (req.body as Record<string, unknown>) ?? {}
  )

  const result = await createRunsForDesignOrder(req.scope, id, { partner_id })

  res.status(200).json({ design_order_production: result })
}
