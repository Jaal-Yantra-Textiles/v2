/**
 * @route POST /admin/inventory-orders/:id/shipments/:shipmentId/manual-booking
 * @scope admin
 *
 * Complete a manual-carrier booking (India Post): the team has booked the
 * parcel on the carrier's side; this fills in the AWB, the tracking link and
 * the label on the partner's `booking_pending` shipment, moves it to
 * `created`, and the partner then sees them in their app.
 *
 * multipart/form-data: awb (required), tracking_url?, notes?, and the label as
 * a PDF file in `files` (or `label_url` when it is already hosted).
 * Success: 200 -> { shipment }
 */
import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework";
import { MedusaError, Modules } from "@medusajs/framework/utils";
import { z } from "@medusajs/framework/zod";
import { completeManualInventoryShipment } from "../../../../../../../workflows/inventory_orders/manual-inventory-shipment";
import { storeLabelPdf } from "../../../../../../../workflows/inventory_orders/lib/store-label-pdf";

const bodySchema = z.object({
  awb: z.string().trim().min(1, "An AWB is required"),
  tracking_url: z.string().trim().url().optional().or(z.literal("").transform(() => undefined)),
  label_url: z.string().trim().url().optional().or(z.literal("").transform(() => undefined)),
  notes: z.string().trim().max(500).optional(),
});

const resolveActorEmail = async (req: AuthenticatedMedusaRequest): Promise<string | undefined> => {
  try {
    const actorId = (req as any).auth_context?.actor_id;
    if (!actorId) return undefined;
    const userService: any = req.scope.resolve(Modules.USER);
    return (await userService.retrieveUser(actorId))?.email;
  } catch {
    return undefined;
  }
};

export async function POST(
  req: AuthenticatedMedusaRequest & { files?: Express.Multer.File[] },
  res: MedusaResponse
) {
  const parsed = bodySchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid request body", details: parsed.error.issues });
  }
  const body = parsed.data;

  const file = (req.files || [])[0];
  if (file && !/pdf/i.test(file.mimetype || "") && !/\.pdf$/i.test(file.originalname || "")) {
    return res.status(400).json({ message: "The label must be a PDF." });
  }

  try {
    const labelUrl = file?.buffer
      ? await storeLabelPdf(req.scope, {
          awb: body.awb,
          base64: file.buffer.toString("base64"),
          filename: `label-${body.awb.replace(/[^A-Za-z0-9_-]/g, "")}.pdf`,
        })
      : body.label_url;

    const shipment = await completeManualInventoryShipment(req.scope, {
      orderId: req.params.id,
      shipmentId: req.params.shipmentId,
      awb: body.awb,
      trackingUrl: body.tracking_url,
      labelUrl,
      notes: body.notes,
      actingEmail: await resolveActorEmail(req),
    });
    return res.status(200).json({ shipment });
  } catch (err: any) {
    const type = err?.type;
    if (type === MedusaError.Types.NOT_FOUND) return res.status(404).json({ message: err.message });
    if (type === MedusaError.Types.NOT_ALLOWED) return res.status(409).json({ message: err.message });
    if (type === MedusaError.Types.INVALID_DATA) return res.status(400).json({ message: err.message });
    throw err;
  }
}
