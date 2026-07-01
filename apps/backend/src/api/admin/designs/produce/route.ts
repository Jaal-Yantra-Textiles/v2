import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { z } from "zod"
import { produceDesignsAsWorkOrder } from "../../../../workflows/designs/produce-designs-as-work-order"

/**
 * POST /admin/designs/produce
 *
 * #826 — "send to production" straight from the designs list, WITHOUT a
 * commissioning (sales) order. Pick N designs + a partner → one production run
 * per design (born sent_to_partner) collated into ONE kind=design work-order.
 *
 * Contrast with POST /admin/orders/:id/design/produce, which fans runs out of a
 * commissioning order's line items (there IS a customer/sale). This path is the
 * no-customer analog for when the operator just wants a partner to make things.
 */
const ProduceBody = z.object({
  design_ids: z.array(z.string()).min(1),
  partner_id: z.string().min(1),
})

export const POST = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
): Promise<void> => {
  const { design_ids, partner_id } = ProduceBody.parse(
    (req.body as Record<string, unknown>) ?? {}
  )

  const result = await produceDesignsAsWorkOrder(
    req.scope,
    design_ids,
    partner_id
  )

  res.status(200).json({ design_production: result })
}
