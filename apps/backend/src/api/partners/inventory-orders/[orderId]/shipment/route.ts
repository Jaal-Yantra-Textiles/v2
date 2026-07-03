/**
 * @route POST /partners/inventory-orders/:orderId/shipment
 * @scope partner
 *
 * #790 slice 2 — standalone carrier-shipment creation for an inventory order
 * (forward → AWB → label), decoupled from the partner /complete path. The
 * acting partner must own the order (IDOR guard, #778 C1) and the order must be
 * in a shippable status (Ready for Delivery / Processing / Partial / Shipped).
 *
 * Body: { carrier?, pickup_stock_location_id?, weight_grams?, dimensions_cm?,
 *         preferred_courier_id?, delivered_quantities? }
 * Success: 200 -> { shipment }
 * Errors:  surfaced from the workflow's clean MedusaError (no pickup configured,
 *          provider missing, …) as a proper 4xx with the actionable message.
 */
import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework";
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils";
import { z } from "@medusajs/framework/zod";
import { getPartnerFromAuthContext, assertPartnerOwnsInventoryOrder } from "../../../helpers";
import { createInventoryOrderShipmentWorkflow } from "../../../../../workflows/inventory_orders/create-inventory-order-shipment";
import { assertShipmentAllowed } from "../../../../../workflows/inventory_orders/lib/shipment-guard";

const bodySchema = z.object({
  carrier: z.string().optional(),
  pickup_stock_location_id: z.string().optional(),
  weight_grams: z.number().positive().optional(),
  dimensions_cm: z.object({
    length: z.number().positive(),
    breadth: z.number().positive(),
    height: z.number().positive(),
  }).partial().optional(),
  preferred_courier_id: z.union([z.string(), z.number()]).optional(),
  delivered_quantities: z.record(z.string(), z.number()).optional(),
  // Requested carrier pickup date ("YYYY-MM-DD"). Optional — omit to let
  // Shiprocket pick the earliest slot.
  pickup_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const orderId = req.params.orderId;

  const parsed = bodySchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid request body", details: parsed.error.issues });
  }

  if (!req.auth_context?.actor_id) {
    return res.status(401).json({ error: "Partner authentication required" });
  }
  const partner = await getPartnerFromAuthContext(req.auth_context, req.scope);
  if (!partner) {
    return res.status(401).json({ error: "Partner authentication required" });
  }
  // #778 C1 — ownership guard (throws NOT_FOUND → 404; closes the IDOR).
  await assertPartnerOwnsInventoryOrder(req.scope, orderId, partner.id);

  // #790 — only ship orders whose goods exist / are ready to move.
  const query: any = req.scope.resolve(ContainerRegistrationKeys.QUERY);
  const { data } = await query.graph({
    entity: "inventory_orders",
    fields: ["id", "status"],
    filters: { id: orderId },
  });
  assertShipmentAllowed((data?.[0] as any)?.status);

  const { result, errors } = await createInventoryOrderShipmentWorkflow(req.scope).run({
    input: {
      orderId,
      carrier: parsed.data.carrier,
      pickupStockLocationId: parsed.data.pickup_stock_location_id,
      weightGrams: parsed.data.weight_grams,
      dimensionsCm: parsed.data.dimensions_cm as any,
      preferredCourierId: parsed.data.preferred_courier_id,
      deliveredQuantities: parsed.data.delivered_quantities,
      pickupDate: parsed.data.pickup_date,
      // The email lives on the partner's admin(s), not the partner org row, so
      // pull the first admin's email — else the Shiprocket pickup registers
      // under the generic account email instead of the partner's contact.
      actingEmail: (partner as any)?.admins?.[0]?.email || undefined,
    },
    throwOnError: false,
  });

  if (errors && errors.length > 0) {
    const err = errors[0]?.error as any;
    const type = err?.type || err?.constructor?.name;
    if (type === MedusaError.Types.NOT_FOUND) return res.status(404).json({ message: err.message });
    if (type === MedusaError.Types.NOT_ALLOWED) return res.status(403).json({ message: err.message });
    if (type === MedusaError.Types.INVALID_DATA) return res.status(400).json({ message: err.message });
    return res.status(400).json({ message: err?.message || "Shipment creation failed", errors });
  }

  return res.status(200).json({ shipment: result });
}
