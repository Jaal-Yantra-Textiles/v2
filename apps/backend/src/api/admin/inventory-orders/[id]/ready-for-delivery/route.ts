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
 * Allowed only from Processing or Partial. Success: 200 -> { order }.
 */
import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework";
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils";
import { updateInventoryOrderWorkflow } from "../../../../../workflows/inventory_orders/update-inventory-order";

const READY_FROM = new Set(["Processing", "Partial"]);

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
      message: `Cannot mark an inventory order "Ready for Delivery" from status '${current ?? "unknown"}'.`,
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
