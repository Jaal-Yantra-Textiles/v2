/**
 * @route GET /admin/inventory-orders/:id/invoice
 * @group InventoryOrders
 * @returns {file} 200 - application/pdf
 * @throws 404 - Inventory order not found
 *
 * The admin mirror of the partner's proforma — byte-identical, because both
 * sides run `gatherInventoryOrderInvoice`. An invoice the partner signed and a
 * copy the admin filed that disagreed on a rate would be worse than having no
 * generator at all.
 *
 * Useful before the partner has it: this is the document to send when a
 * supplier has no invoicing software, and the one to check a paper invoice
 * against when they do.
 *
 * Read-only — no status change, no event, no write.
 */
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import { gatherInventoryOrderInvoice } from "../../../../../lib/invoices/gather-inventory-order-invoice"
import { renderInventoryOrderInvoicePdf } from "../../../../../lib/invoices/render-inventory-order-invoice"

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const { id } = req.params

  const model = await gatherInventoryOrderInvoice(req.scope, id)
  const pdf = await renderInventoryOrderInvoicePdf(model)

  res.setHeader("Content-Type", "application/pdf")
  res.setHeader("Content-Disposition", `inline; filename="proforma-${id}.pdf"`)
  res.end(Buffer.from(pdf))
}
