/**
 * @route GET /partners/inventory-orders/:orderId/shipment-carriers
 * @scope partner
 *
 * The carriers a partner may book this order's shipment with, and how each is
 * booked (`api` now, or `manual`: the team books it and the AWB appears
 * later). Replaces the lists hardcoded in the web and native apps.
 */
import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework";
import { getPartnerFromAuthContext, assertPartnerOwnsInventoryOrder } from "../../../helpers";
import { PARTNER_SHIPMENT_CARRIERS } from "../../../../../workflows/inventory_orders/lib/manual-carriers";

export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  if (!req.auth_context?.actor_id) {
    return res.status(401).json({ error: "Partner authentication required" });
  }
  const partner = await getPartnerFromAuthContext(req.auth_context, req.scope);
  if (!partner) {
    return res.status(401).json({ error: "Partner authentication required" });
  }
  await assertPartnerOwnsInventoryOrder(req.scope, req.params.orderId, partner.id);
  return res.status(200).json({ carriers: PARTNER_SHIPMENT_CARRIERS });
}
