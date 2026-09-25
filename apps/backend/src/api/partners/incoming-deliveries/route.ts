/**
 * @route GET /partners/incoming-deliveries
 * @scope partner
 *
 * #2286 — inventory orders whose goods are delivered TO this partner's
 * warehouse, whoever supplies them.
 *
 * Inventory work orders are listed for the partner an order was SENT to (the
 * supplier). The partner it is delivered to could not see it at all — Ksaman
 * held GOF's 70.60 m with no order on their screen and no way to say it had
 * arrived. This is their side of the same order.
 *
 * Deliberately NO prices: what we paid the supplier is not the receiving
 * partner's business. Lines carry what was ordered, what has been received so
 * far, and what is still outstanding — the numbers they confirm against.
 *
 * `?all=true` includes fully received orders; by default only those with
 * something still outstanding are listed.
 *
 * Success: 200 -> { incoming_deliveries: [...], count, location_id }
 */
import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { readIncomingDeliveries } from "../lib/incoming-deliveries"
import { resolvePartnerHomeLocation } from "../lib/partner-home-location"

export const GET = async (req: AuthenticatedMedusaRequest, res: MedusaResponse) => {
  const { location_id } = await resolvePartnerHomeLocation(req.auth_context, req.scope)
  if (!location_id) {
    return res.json({ incoming_deliveries: [], count: 0, location_id: null })
  }
  const includeAll = String((req.query as any)?.all ?? "") === "true"
  const deliveries = await readIncomingDeliveries(req.scope, location_id, includeAll)
  res.json({ incoming_deliveries: deliveries, count: deliveries.length, location_id })
}
