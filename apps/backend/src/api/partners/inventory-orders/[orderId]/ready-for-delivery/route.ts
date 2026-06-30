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
 * Allowed only from Partial (completion must be recorded first). Success: 200 -> { order }.
 */
import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework";
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils";
import { getPartnerFromAuthContext, assertPartnerOwnsInventoryOrder } from "../../../helpers";
import { updateInventoryOrderWorkflow } from "../../../../../workflows/inventory_orders/update-inventory-order";

// Only a partially-fulfilled order may be marked Ready for Delivery: completion
// must be recorded first. "Processing" means started but nothing fulfilled yet,
// so marking it ready would claim goods are packed before any were produced.
// (Full completion already moves the order straight to "Shipped".)
const READY_FROM = new Set(["Partial"]);

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
      message: `Cannot mark "Ready for Delivery" from status '${current ?? "unknown"}' — complete (fulfill) the order first; only a partially-fulfilled (Partial) order can be marked ready.`,
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
