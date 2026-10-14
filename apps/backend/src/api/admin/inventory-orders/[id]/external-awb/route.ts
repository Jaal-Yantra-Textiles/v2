/**
 * @route POST /admin/inventory-orders/:id/external-awb
 * @scope admin
 *
 * Attach a waybill booked OUTSIDE the system (carrier portal, direct API call,
 * a counter booking) to an inventory order, so the order lists the shipment
 * like one booked through POST /admin/inventory-orders/:id/shipment. The
 * inventory-side twin of POST /admin/orders/:id/external-awb.
 *
 * NO carrier API is called. ADMIN ONLY: asserting a parcel is out on a carrier
 * we did not book through is a claim only staff should make. No stock moves —
 * a shipment is not a receipt.
 *
 * Body: { awb, carrier, tracking_url?, label_url?, weight_grams?,
 *         dimensions_cm?, pickup_stock_location_id?, notes? }
 * Success: 200 -> { external_awb }
 */
import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework";
import { MedusaError, Modules } from "@medusajs/framework/utils";
import { z } from "@medusajs/framework/zod";
import { attachInventoryOrderExternalAwb } from "../../../../../workflows/inventory_orders/attach-inventory-order-external-awb";

/** The logged-in admin's email, recorded on the attachment. */
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
  awb: z.string().trim().min(1, "An AWB is required"),
  carrier: z.string().trim().min(1, "A carrier name is required"),
  tracking_url: z.string().trim().url().optional(),
  label_url: z.string().trim().url().optional(),
  weight_grams: z.number().positive().optional(),
  dimensions_cm: z
    .object({
      length: z.number().positive().optional(),
      breadth: z.number().positive().optional(),
      width: z.number().positive().optional(),
      height: z.number().positive().optional(),
    })
    .optional(),
  pickup_stock_location_id: z.string().trim().min(1).optional(),
  notes: z.string().trim().max(500).optional(),
});

export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const parsed = bodySchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid request body", details: parsed.error.issues });
  }
  const body = parsed.data;

  try {
    const result = await attachInventoryOrderExternalAwb(req.scope, {
      orderId: req.params.id,
      awb: body.awb,
      carrier: body.carrier,
      trackingUrl: body.tracking_url,
      labelUrl: body.label_url,
      weightGrams: body.weight_grams,
      dimensionsCm: body.dimensions_cm,
      pickupStockLocationId: body.pickup_stock_location_id,
      notes: body.notes,
      actingEmail: await resolveActorEmail(req),
    });
    return res.status(200).json({ external_awb: result });
  } catch (err: any) {
    const type = err?.type;
    if (type === MedusaError.Types.NOT_FOUND) return res.status(404).json({ message: err.message });
    if (type === MedusaError.Types.NOT_ALLOWED) return res.status(409).json({ message: err.message });
    throw err;
  }
}
