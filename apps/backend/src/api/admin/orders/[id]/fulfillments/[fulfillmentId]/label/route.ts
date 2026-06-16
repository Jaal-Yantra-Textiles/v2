import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import {
  isSupportedCarrier,
  resolveShippingProvider,
  shipmentRefFromFulfillment,
} from "../../../../../../../modules/shipping-providers/resolver"

/**
 * GET /admin/orders/:id/fulfillments/:fulfillmentId/label
 *
 * #404 (#31) PR-B — admin mirror of the partner label route. Fetches the
 * shipping label for a fulfillment whose `data` carries the carrier refs
 * (populated by the shiprocket-shipment route). Falls back to the stored label
 * for manual (no-carrier) fulfillments.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data: orders } = await query.graph({
    entity: "orders",
    fields: ["id", "fulfillments.*", "fulfillments.labels.*"],
    filters: { id: req.params.id },
  })

  const order = (orders as any)?.[0]
  const fulfillment = order?.fulfillments?.find(
    (f: any) => f.id === req.params.fulfillmentId
  )
  if (!fulfillment) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, "Fulfillment not found")
  }

  const waybill = fulfillment.data?.waybill || fulfillment.data?.tracking_number
  if (!waybill) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      "No waybill found for this fulfillment"
    )
  }

  const carrier = fulfillment.data?.carrier
  if (!isSupportedCarrier(carrier)) {
    const label = fulfillment.labels?.[0]
    res.json({
      label_url: label?.label_url || "",
      tracking_number: label?.tracking_number || waybill,
      packing_slip: null,
    })
    return
  }

  const provider = await resolveShippingProvider(req.scope, carrier)
  const label = await provider.getLabel(shipmentRefFromFulfillment(fulfillment.data))

  res.json({
    label_url: label.label_url || "",
    tracking_number: waybill,
    packing_slip: label.raw ?? label.data ?? null,
  })
}
