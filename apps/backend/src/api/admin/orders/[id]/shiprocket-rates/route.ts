import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import {
  getShiprocketRatesForOrder,
  parseRateQuery,
} from "../../../../../workflows/orders/shiprocket-rates"

/**
 * GET /admin/orders/:id/shiprocket-rates
 *
 * #641 — list the Shiprocket courier options for an order so the Design-Orders
 * UI can show a picker (rate / ETA / recommended) before Generate-Label. Wraps
 * `ShiprocketClient.getRates` using the order's registered pickup pincode +
 * shipping-address pincode + a package weight (`?weight_grams=` override).
 *
 * Errors (no pickup, no destination pincode, ShiprocketApiError #427) surface
 * cleanly to the UI toast.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  // Dimensions matter on a cross-border quote (volumetric weight + which
  // couriers accept the size), so the parsing is shared with every other rate
  // route rather than hand-rolled per route.
  const result = await getShiprocketRatesForOrder(req.scope, {
    orderId: req.params.id,
    ...parseRateQuery(req.query as Record<string, any>),
  })

  res.status(200).json(result)
}
