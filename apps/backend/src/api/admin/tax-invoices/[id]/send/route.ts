import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"

import { sendTaxInvoiceEmail } from "../../../../../lib/invoices/send-tax-invoice-email"
import type { SendTaxInvoiceBody } from "./validators"

/**
 * POST /admin/tax-invoices/:id/send
 *
 * Email the buyer this GST tax invoice through the `order-tax-invoice` email
 * template, PDF attached (#2532). `{ preview: true }` sends nothing; a send
 * needs `confirm: true`.
 */
export const POST = async (
  req: MedusaRequest<SendTaxInvoiceBody>,
  res: MedusaResponse
) => {
  const body = (req.validatedBody ?? {}) as SendTaxInvoiceBody
  if (!body.preview && !body.confirm) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Sending emails the buyer and cannot be recalled. Run with preview:true first, then pass confirm:true."
    )
  }
  const result = await sendTaxInvoiceEmail(req.scope, {
    invoice_id: req.params.id,
    preview: Boolean(body.preview),
  })
  res.json(result)
}
