import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"

import { sendOrderInvoice } from "../../../../../lib/payments/send-order-invoice"

/**
 * POST /admin/orders/:id/invoice
 *
 * Email the buyer an itemised invoice: every line at the price on the order,
 * what is paid, the balance and its pay link. When an order edit moved the
 * total after the deposit, the payment schedule's balance is first moved to
 * the order's pending difference so the link charges the edited amount.
 *
 * `{ preview: true }` returns the invoice and the schedule change and writes
 * nothing. Anything else must carry `confirm: true`: it can change what the
 * buyer is asked to pay, and it sends an email that cannot be recalled.
 */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const body = (req.validatedBody ?? req.body ?? {}) as {
    preview?: boolean
    confirm?: boolean
  }

  if (!body.preview && !body.confirm) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Sending an invoice emails the buyer and can rebill the balance. Run with preview:true first, then pass confirm:true."
    )
  }

  const result = await sendOrderInvoice(req.scope, {
    order_id: req.params.id,
    preview: Boolean(body.preview),
  })

  return res.json(result)
}
