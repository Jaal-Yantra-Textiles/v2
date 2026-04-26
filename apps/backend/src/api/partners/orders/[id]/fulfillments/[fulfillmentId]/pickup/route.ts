import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { validatePartnerOrderOwnership } from "../../../../../helpers"
import { DelhiveryClient } from "../../../../../../../modules/shipping-providers/delhivery/client"

export const POST = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  await validatePartnerOrderOwnership(req.auth_context, req.params.id, req.scope)

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data: orders } = await query.graph({
    entity: "orders",
    fields: [
      "id",
      "fulfillments.*",
      "fulfillments.labels.*",
    ],
    filters: { id: req.params.id },
  })

  const order = (orders as any)?.[0]
  const fulfillment = order?.fulfillments?.find(
    (f: any) => f.id === req.params.fulfillmentId
  )

  if (!fulfillment) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, "Fulfillment not found")
  }

  if (fulfillment.data?.carrier !== "delhivery") {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Pickup scheduling is only available for Delhivery shipments"
    )
  }

  // Get the stock location to find the registered warehouse name
  const locationId = fulfillment.location_id
  if (!locationId) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      "No stock location associated with this fulfillment"
    )
  }

  const { data: locations } = await query.graph({
    entity: "stock_location",
    fields: ["id", "metadata"],
    filters: { id: locationId },
  })

  const location = (locations as any)?.[0]
  const warehouseName =
    location?.metadata?.delhivery_warehouse_name ||
    fulfillment.data?.pickup_location_name

  if (!warehouseName) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      "No Delhivery warehouse registered for this location"
    )
  }

  const delhiveryToken = process.env.DELHIVERY_API_TOKEN
  if (!delhiveryToken) {
    throw new MedusaError(
      MedusaError.Types.UNEXPECTED_STATE,
      "Delhivery API token not configured"
    )
  }

  const body = req.body as any
  const pickupDate = body.pickup_date
  const pickupTime = body.pickup_time

  if (!pickupDate || !pickupTime) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "pickup_date and pickup_time are required"
    )
  }

  const client = new DelhiveryClient({
    api_token: delhiveryToken,
    sandbox: process.env.DELHIVERY_SANDBOX === "true",
  })

  const result = await client.schedulePickup({
    pickup_date: pickupDate,
    pickup_time: pickupTime,
    pickup_location: warehouseName,
    expected_package_count: body.expected_package_count || 1,
  })

  res.json({
    pickup_id: result.pickup_id,
    pickup_date: pickupDate,
    pickup_time: pickupTime,
    incoming_center_name: result.incoming_center_name,
    ...result,
  })
}
