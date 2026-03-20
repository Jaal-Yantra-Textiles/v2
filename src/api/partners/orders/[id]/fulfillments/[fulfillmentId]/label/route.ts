import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { validatePartnerOrderOwnership } from "../../../../../helpers"
import { DelhiveryClient } from "../../../../../../../modules/shipping-providers/delhivery/client"

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
  if (carrier !== "delhivery") {
    // For non-Delhivery providers, return existing label data
    const label = fulfillment.labels?.[0]
    res.json({
      label_url: label?.label_url || "",
      tracking_number: label?.tracking_number || waybill,
      packing_slip: null,
    })
    return
  }

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

  const packingSlip = await client.getLabel(waybill)

  res.json({
    label_url: `https://www.delhivery.com/track/package/${waybill}`,
    tracking_number: waybill,
    packing_slip: packingSlip,
  })
}
