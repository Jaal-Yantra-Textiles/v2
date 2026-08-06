import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import { validatePartnerOrderOwnership } from "../../../helpers"
import {
  getShiprocketRatesForOrder,
  parseRateQuery,
} from "../../../../../workflows/orders/shiprocket-rates"

/**
 * GET /partners/orders/:id/shiprocket-rates
 *
 * Partner mirror of `GET /admin/orders/:id/shiprocket-rates` (#641). Lists the
 * carrier's courier options (rate / ETA / recommended) for one of the partner's
 * own orders, so the Mark-as-Shipped carrier step can show a picker before
 * Generate-Label. The chosen `courier_id` threads back into
 * `POST /partners/orders/:id/shiprocket-label` as `preferred_courier_id`; when
 * none is chosen the carrier auto-selects.
 *
 * Partner ownership is enforced INSIDE the handler (retail sales-channel OR the
 * partner↔order work link) — a foreign order 404s before any carrier work runs,
 * same guard as the label route.
 *
 * Read-only: this quotes, it never creates a shipment. `?carrier=` and
 * `?weight_grams=` refine the quote (the carrier step's parcel weight feeds the
 * latter so the estimate matches the parcel that will actually ship).
 */
export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const orderId = req.params.id
  await validatePartnerOrderOwnership(req.auth_context, orderId, req.scope)

  const result = await getShiprocketRatesForOrder(req.scope, {
    orderId,
    ...parseRateQuery(req.query as Record<string, any>),
  })

  res.status(200).json(result)
}
