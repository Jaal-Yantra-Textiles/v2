/**
 * @route POST /admin/inventory-orders/:id/shipments/:shipmentId/cancel
 * @scope admin
 *
 * Void one carrier shipment (AWB) on an inventory order — a supplier pickup
 * that never happened, a wrong box, a date the supplier can't make. Cancels at
 * the carrier FIRST, then marks the shipment cancelled, archives the
 * metadata.shipment mirror and logs the timeline. A fresh shipment can then be
 * booked with POST /admin/inventory-orders/:id/shipment.
 *
 * ADMIN ONLY, like the core-order cancel: a cancel moves money at the carrier.
 *
 * Body: { reason?, force? }
 * Success: 200 -> { cancelled_shipment }
 */
import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework";
import { MedusaError, Modules } from "@medusajs/framework/utils";
import { z } from "@medusajs/framework/zod";
import { cancelInventoryOrderShipment } from "../../../../../../../workflows/inventory_orders/cancel-inventory-order-shipment";

/** The logged-in admin's email, recorded on the cancellation. */
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
  reason: z.string().trim().min(1).optional(),
  force: z.boolean().optional(),
});

export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const parsed = bodySchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid request body", details: parsed.error.issues });
  }

  try {
    const result = await cancelInventoryOrderShipment(req.scope, {
      orderId: req.params.id,
      shipmentId: req.params.shipmentId,
      reason: parsed.data.reason,
      force: parsed.data.force === true,
      actingEmail: await resolveActorEmail(req),
    });
    return res.status(200).json({ cancelled_shipment: result });
  } catch (err: any) {
    const type = err?.type;
    if (type === MedusaError.Types.NOT_FOUND) return res.status(404).json({ message: err.message });
    if (type === MedusaError.Types.NOT_ALLOWED) return res.status(409).json({ message: err.message });
    if (type === MedusaError.Types.UNEXPECTED_STATE) return res.status(502).json({ message: err.message });
    throw err;
  }
}
