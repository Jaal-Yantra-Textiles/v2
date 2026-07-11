import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { getShiprocketRatesForOrder } from "../../../../../workflows/orders/shiprocket-rates"

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
  const orderId = req.params.id
  const carrierRaw = req.query.carrier
  const carrier =
    typeof carrierRaw === "string" && carrierRaw ? carrierRaw : undefined
  const weightRaw = req.query.weight_grams
  const weightGrams = weightRaw != null ? Number(weightRaw) : undefined

  const result = await getShiprocketRatesForOrder(req.scope, {
    orderId,
    carrier,
    weightGrams:
      weightGrams != null && Number.isFinite(weightGrams) && weightGrams > 0
        ? weightGrams
        : undefined,
  })

  res.status(200).json(result)
}
