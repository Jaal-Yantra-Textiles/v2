/**
 * @route POST /admin/inventory-orders/:id/ready-for-delivery
 * @scope admin
 *
 * #790 slice 2/3 — admin marks an inventory order "Ready for Delivery" (admin
 * mirror of the partner route; feedback_partner_api_mirrors_admin). Routes
 * through the singular update workflow so the #776 status-changed event +
 * unified mirror fire — and so it isn't blocked by the generic PUT's
 * "Pending/Processing only" edit lock (which would reject a Partial order).
 *
 * Allowed only from Partial (completion must be recorded first). Success: 200 -> { order }.
 */
import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework";
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils";
import { updateInventoryOrderWorkflow } from "../../../../../workflows/inventory_orders/update-inventory-order";

// Only a partially-fulfilled order may be marked Ready for Delivery: completion
// must be recorded first. "Processing" means started but nothing fulfilled yet,
// so marking it ready would claim goods are packed before any were produced.
// (Full completion already moves the order straight to "Shipped".)
const READY_FROM = new Set(["Partial"]);

export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const id = req.params.id;

  const query: any = req.scope.resolve(ContainerRegistrationKeys.QUERY);
  const { data } = await query.graph({
    entity: "inventory_orders",
    fields: ["id", "status"],
    filters: { id },
  });
  if (!data?.[0]) {
    return res.status(404).json({ message: `Inventory order ${id} not found` });
  }
  const current = (data[0] as any).status;
  if (!READY_FROM.has(String(current ?? ""))) {
    return res.status(400).json({
      message: `Cannot mark "Ready for Delivery" from status '${current ?? "unknown"}' — record completion (fulfill the order) first; only a partially-fulfilled (Partial) order can be marked ready.`,
    });
  }

  const { result, errors } = await updateInventoryOrderWorkflow(req.scope).run({
    input: { id, update: { status: "Ready for Delivery" } },
    throwOnError: false,
  });

  if (errors && errors.length > 0) {
    const err = errors[0]?.error as any;
    if ((err?.type || err?.constructor?.name) === MedusaError.Types.NOT_FOUND) {
      return res.status(404).json({ message: err.message });
    }
    return res.status(400).json({ message: err?.message || "Failed to update status", errors });
  }

  return res.status(200).json({ order: result });
}
