import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { z } from "zod"
import { createShiprocketShipmentForFulfillment } from "../../../../../../../workflows/orders/shiprocket-shipment"

/**
 * POST /admin/orders/:id/fulfillments/:fulfillmentId/shiprocket-shipment
 *
 * #404 (#31) PR-B — create the Shiprocket shipment (forward order → AWB → label)
 * for a fulfillment of the order, persisting the carrier refs onto
 * `fulfillment.data`. Returns the AWB + label URL (Shiprocket bundles label
 * generation into shipment creation). The fulfillment is created first via
 * Medusa core's `POST /admin/orders/:id/fulfillments`.
 *
 * Shiprocket failures throw a ShiprocketApiError (a MedusaError, #427), so the
 * framework returns a clean error instead of a 500.
 */
const Body = z.object({
  pickup_location_name: z.string().optional(),
  weight_grams: z.coerce.number().positive().optional(),
  dimensions_cm: z
    .object({
      length: z.coerce.number(),
      width: z.coerce.number(),
      height: z.coerce.number(),
    })
    .optional(),
  preferred_courier_id: z.union([z.string(), z.number()]).optional(),
})

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const body = Body.parse((req.body as Record<string, unknown>) ?? {})

  const result = await createShiprocketShipmentForFulfillment(req.scope, {
    orderId: req.params.id,
    fulfillmentId: req.params.fulfillmentId,
    pickupLocationName: body.pickup_location_name,
    weightGrams: body.weight_grams,
    dimensionsCm: body.dimensions_cm,
    preferredCourierId: body.preferred_courier_id,
  })

  res.status(200).json({ shipment: result })
}
