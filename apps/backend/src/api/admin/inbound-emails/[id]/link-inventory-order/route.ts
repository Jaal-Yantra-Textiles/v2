import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { linkInboundEmailToInventoryOrder } from "../../../../../workflows/inbound-emails/lib/inbound-email-links"
import { LinkInboundEmailInventoryOrderBody } from "../../validators"

/**
 * #2377 S3 — record that this email became that inventory order: writes the
 * link and marks the email processed. Re-linking the same pair is a no-op.
 */
export const POST = async (
  req: MedusaRequest<LinkInboundEmailInventoryOrderBody>,
  res: MedusaResponse
) => {
  const { id } = req.params
  const { inventory_order_id } = req.validatedBody
  const result = await linkInboundEmailToInventoryOrder(req.scope, id, inventory_order_id)
  res.status(200).json({ inbound_email_id: id, status: "processed", ...result })
}
