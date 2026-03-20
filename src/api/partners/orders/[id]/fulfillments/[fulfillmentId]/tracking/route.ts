import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { validatePartnerOrderOwnership } from "../../../../../helpers"
import { DelhiveryClient } from "../../../../../../../modules/shipping-providers/delhivery/client"
import { normalizeDelhiveryTracking } from "./normalize-delhivery"

export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  await validatePartnerOrderOwnership(req.auth_context, req.params.id, req.scope)

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

  if (carrier === "delhivery") {
    const delhiveryToken = process.env.DELHIVERY_API_TOKEN
    if (!delhiveryToken) {
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        "Delhivery API token not configured"
      )
    }

    const client = new DelhiveryClient({
      api_token: delhiveryToken,
      sandbox: process.env.DELHIVERY_SANDBOX === "true",
    })

    const rawTracking = await client.trackShipment(waybill)
    const normalized = normalizeDelhiveryTracking(rawTracking)

    res.json(normalized)
    return
  }

  // For non-Delhivery providers, return basic timeline from fulfillment timestamps
  const events: Array<{
    timestamp: string
    status: string
    location: string
    scan_type: string
  }> = []

  if (fulfillment.created_at) {
    events.push({
      timestamp: fulfillment.created_at,
      status: "Fulfillment created",
      location: "",
      scan_type: "created",
    })
  }
  if (fulfillment.shipped_at) {
    events.push({
      timestamp: fulfillment.shipped_at,
      status: "Shipped",
      location: "",
      scan_type: "shipped",
    })
  }
  if (fulfillment.delivered_at) {
    events.push({
      timestamp: fulfillment.delivered_at,
      status: "Delivered",
      location: "",
      scan_type: "delivered",
    })
  }
  if (fulfillment.canceled_at) {
    events.push({
      timestamp: fulfillment.canceled_at,
      status: "Canceled",
      location: "",
      scan_type: "canceled",
    })
  }

  events.sort((a, b) =>
    new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  )

  const currentStatus = fulfillment.canceled_at
    ? "Canceled"
    : fulfillment.delivered_at
    ? "Delivered"
    : fulfillment.shipped_at
    ? "Shipped"
    : "Awaiting Shipping"

  res.json({
    waybill,
    carrier: carrier || "unknown",
    current_status: currentStatus,
    current_status_type: "",
    estimated_delivery: null,
    origin: "",
    destination: "",
    events,
  })
}
