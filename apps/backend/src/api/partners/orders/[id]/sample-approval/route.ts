import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { z } from "@medusajs/framework/zod"

import { decideOrderSample } from "../../../../../lib/payments/order-sample-decision"
import { assertNotWorkOrder, validatePartnerOrderOwnership } from "../../../helpers"

/**
 * POST /partners/orders/:id/sample-approval
 *
 * The partner mirror of the admin route: the maker records their buyer's
 * verdict on a sample. On a deal whose balance is released by the sample,
 * approval asks the buyer for the balance; a rejection asks for nothing.
 * Only the partner who owns the order can decide it.
 *
 * Body: { production_run_id, decision: "approved" | "rejected", notes?, confirm? }
 */
const bodySchema = z.object({
  production_run_id: z.string().min(1),
  decision: z.enum(["approved", "rejected"]),
  notes: z.string().trim().min(1).optional(),
  confirm: z.boolean().optional(),
})

export const POST = async (req: AuthenticatedMedusaRequest, res: MedusaResponse) => {
  const orderId = req.params.id
  const { partner } = await validatePartnerOrderOwnership(req.auth_context, orderId, req.scope)
  await assertNotWorkOrder(orderId, req.scope)

  const parsed = bodySchema.safeParse(req.body ?? {})
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid request body", details: parsed.error.issues })
  }
  if (parsed.data.decision === "approved" && parsed.data.confirm !== true) {
    return res.status(400).json({
      message:
        "Approving the sample asks your buyer for the balance. Pass confirm:true once they have approved it.",
    })
  }

  try {
    const result = await decideOrderSample(req.scope, {
      order_id: orderId,
      production_run_id: parsed.data.production_run_id,
      decision: parsed.data.decision,
      notes: parsed.data.notes ?? null,
      decided_by: partner?.id ? `partner:${partner.id}` : "partner",
    })
    return res.status(200).json({ sample_decision: result })
  } catch (err: any) {
    const type = err?.type
    if (type === MedusaError.Types.NOT_FOUND) return res.status(404).json({ message: err.message })
    if (type === MedusaError.Types.NOT_ALLOWED) return res.status(409).json({ message: err.message })
    if (type === MedusaError.Types.INVALID_DATA) return res.status(400).json({ message: err.message })
    throw err
  }
}
