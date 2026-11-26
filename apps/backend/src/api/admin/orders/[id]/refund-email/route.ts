import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"

import { sendOrderRefundEmail } from "../../../../../lib/payments/order-refund-email"
import type { SendOrderRefundEmailBody } from "./validators"

/**
 * POST /admin/orders/:id/refund-email (#2645)
 *
 * Email the buyer that they were refunded: the amount, the admin's `note`
 * (why), what they have paid, and any balance still owed and when.
 *
 * `amount` defaults to the order's latest refund. `{ dry_run: true }` (or
 * `preview: true`) returns the rendered subject/html and recipient and sends
 * nothing. A real send must carry `confirm: true`: the email cannot be
 * recalled.
 */
export const POST = async (
  req: MedusaRequest<SendOrderRefundEmailBody>,
  res: MedusaResponse
) => {
  const body = (req.validatedBody ?? {}) as SendOrderRefundEmailBody
  const preview = Boolean(body.dry_run || body.preview)

  if (!preview && !body.confirm) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Sending a refund email cannot be undone. Run with dry_run:true (or preview:true) first, then pass confirm:true."
    )
  }

  const result = await sendOrderRefundEmail(req.scope, {
    order_id: req.params.id,
    amount: body.amount ?? null,
    note: body.note ?? null,
    preview,
    source: "manual",
  })

  return res.json(result)
}
