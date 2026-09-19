/**
 * @file Partner API route for the printable proforma of an assigned inventory order
 * @module API/Partners/InventoryOrders
 */

/**
 * @route GET /partners/inventory-orders/:orderId/invoice
 * @group InventoryOrders
 * @param {string} orderId.path.required - An inventory order assigned to the caller
 * @returns {file} 200 - application/pdf
 * @throws 401 - Partner authentication required
 * @throws 404 - Not found, or not assigned to this partner
 *
 * The paper face of an order the partner has already agreed to.
 *
 * 🔑 We generate it, the partner signs it. A supplier here often has no
 * invoicing software at all, and the figures we would need them to state are
 * figures we already hold — the lines, the per-metre dye cost, the tax they
 * proposed. Asking them to retype that into a document is how the two copies
 * come to disagree.
 *
 * 🔴 It is titled a PROFORMA and says so on its face. Issuing a tax invoice is
 * the supplier's act; a PDF of ours dressed as one would be a document about
 * their tax position written by their customer.
 *
 * Read-only. Generating the paper must never be what moves an order forward,
 * so this touches no status, emits no event and writes nothing — a partner may
 * print it as often as they like.
 */
import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"

import { getPartnerFromAuthContext, assertPartnerOwnsInventoryOrder } from "../../../helpers"
import { gatherInventoryOrderInvoice } from "../../../../../lib/invoices/gather-inventory-order-invoice"
import { renderInventoryOrderInvoicePdf } from "../../../../../lib/invoices/render-inventory-order-invoice"

export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const { orderId } = req.params

  const partner = await getPartnerFromAuthContext(req.auth_context, req.scope)
  if (!partner) {
    throw new MedusaError(
      MedusaError.Types.UNAUTHORIZED,
      "Partner authentication required"
    )
  }

  /**
   * 404s rather than 403s for someone else's order — the same rule the mutation
   * routes use, so the invoice route cannot be used to discover which order ids
   * exist.
   */
  await assertPartnerOwnsInventoryOrder(req.scope, orderId, partner.id)

  const model = await gatherInventoryOrderInvoice(req.scope, orderId)
  const pdf = await renderInventoryOrderInvoicePdf(model)

  res.setHeader("Content-Type", "application/pdf")
  res.setHeader(
    "Content-Disposition",
    `inline; filename="proforma-${orderId}.pdf"`
  )
  res.end(Buffer.from(pdf))
}
