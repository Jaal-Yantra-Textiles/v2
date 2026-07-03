/**
 * @route POST /admin/inventory-orders/:id/shipment
 * @scope admin
 *
 * #790 slice 2 — admin mirror of the partner standalone shipment endpoint
 * (feedback_partner_api_mirrors_admin): generate a real carrier shipment
 * (forward → AWB → label) for an inventory order. No ownership guard — admin
 * sees all orders. The order must be in a shippable status.
 *
 * Body: { carrier?, pickup_stock_location_id?, weight_grams?, dimensions_cm?,
 *         preferred_courier_id?, delivered_quantities? }
 * Success: 200 -> { shipment }
 */
import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework";
import { ContainerRegistrationKeys, MedusaError, Modules } from "@medusajs/framework/utils";
import { z } from "@medusajs/framework/zod";
import { createInventoryOrderShipmentWorkflow } from "../../../../../workflows/inventory_orders/create-inventory-order-shipment";
import { assertShipmentAllowed } from "../../../../../workflows/inventory_orders/lib/shipment-guard";

/** The logged-in admin's email, used as the Shiprocket pickup contact. */
const resolveActorEmail = async (
  req: AuthenticatedMedusaRequest
): Promise<string | undefined> => {
  try {
    const actorId = (req as any).auth_context?.actor_id;
    if (!actorId) return undefined;
    const userService: any = req.scope.resolve(Modules.USER);
    const user = await userService.retrieveUser(actorId);
    return user?.email;
  } catch {
    return undefined;
  }
};

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
  const id = req.params.id;

  const parsed = bodySchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid request body", details: parsed.error.issues });
  }

  const query: any = req.scope.resolve(ContainerRegistrationKeys.QUERY);
  const { data } = await query.graph({
    entity: "inventory_orders",
    fields: ["id", "status"],
    filters: { id },
  });
  if (!data?.[0]) {
    return res.status(404).json({ message: `Inventory order ${id} not found` });
  }
  assertShipmentAllowed((data[0] as any).status);

  const { result, errors } = await createInventoryOrderShipmentWorkflow(req.scope).run({
    input: {
      orderId: id,
      carrier: parsed.data.carrier,
      pickupStockLocationId: parsed.data.pickup_stock_location_id,
      weightGrams: parsed.data.weight_grams,
      dimensionsCm: parsed.data.dimensions_cm as any,
      preferredCourierId: parsed.data.preferred_courier_id,
      deliveredQuantities: parsed.data.delivered_quantities,
      pickupDate: parsed.data.pickup_date,
      // Record the acting admin's email as the Shiprocket pickup contact
      // rather than falling back to the generic account email.
      actingEmail: await resolveActorEmail(req),
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
