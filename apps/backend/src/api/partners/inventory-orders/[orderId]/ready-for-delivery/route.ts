/**
 * @route POST /partners/inventory-orders/:orderId/ready-for-delivery
 * @scope partner
 *
 * #790 slice 2 — partner marks an inventory order "Ready for Delivery" (goods
 * packed, ready to hand to the carrier). The partner portal has no generic
 * status PUT (admin reuses /admin/inventory-orders/:id), so this dedicated,
 * IDOR-guarded route is the partner's transition. Routes through the singular
 * update workflow so the #776 status-changed event + unified-order mirror fire.
 *
 * Allowed only from Processing or Partial. Success: 200 -> { order }.
 */
import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework";
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils";
import { getPartnerFromAuthContext, assertPartnerOwnsInventoryOrder } from "../../../helpers";
import { updateInventoryOrderWorkflow } from "../../../../../workflows/inventory_orders/update-inventory-order";

const READY_FROM = new Set(["Processing", "Partial"]);

export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const orderId = req.params.orderId;

  if (!req.auth_context?.actor_id) {
    return res.status(401).json({ error: "Partner authentication required" });
  }
  const partner = await getPartnerFromAuthContext(req.auth_context, req.scope);
  if (!partner) {
    return res.status(401).json({ error: "Partner authentication required" });
  }
  await assertPartnerOwnsInventoryOrder(req.scope, orderId, partner.id);

  const query: any = req.scope.resolve(ContainerRegistrationKeys.QUERY);
  const { data } = await query.graph({
    entity: "inventory_orders",
    fields: ["id", "status"],
    filters: { id: orderId },
  });
  const current = (data?.[0] as any)?.status;
  if (!READY_FROM.has(String(current ?? ""))) {
    return res.status(400).json({
      message: `Cannot mark an inventory order "Ready for Delivery" from status '${current ?? "unknown"}'.`,
    });
  }

  const { result, errors } = await updateInventoryOrderWorkflow(req.scope).run({
    input: { id: orderId, update: { status: "Ready for Delivery" } },
    throwOnError: false,
  });

  if (errors && errors.length > 0) {
    const err = errors[0]?.error as any;
    const type = err?.type || err?.constructor?.name;
    if (type === MedusaError.Types.NOT_FOUND) return res.status(404).json({ message: err.message });
    return res.status(400).json({ message: err?.message || "Failed to update status", errors });
  }

  return res.status(200).json({ order: result });
}
