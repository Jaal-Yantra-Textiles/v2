import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, MedusaError, Modules } from "@medusajs/framework/utils"
import { validatePartnerStoreAccess } from "../../../../../../helpers"

export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  await validatePartnerStoreAccess(
    req.auth_context,
    req.params.id,
    req.scope
  )

  const { serviceZoneId } = req.params

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data: zones } = await query.graph({
    entity: "service_zones",
    fields: ["*", "geo_zones.*", "shipping_options.*"],
    filters: { id: serviceZoneId },
  })

  if (!zones?.[0]) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Service zone ${serviceZoneId} not found`
    )
  }

  res.json({ service_zone: zones[0] })
}

export const POST = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  await validatePartnerStoreAccess(
    req.auth_context,
    req.params.id,
    req.scope
  )

  const { serviceZoneId } = req.params
  const body = req.body as Record<string, any>

  const fulfillmentService = req.scope.resolve(Modules.FULFILLMENT) as any
  const updated = await fulfillmentService.updateServiceZones(serviceZoneId, body)

  res.json({ service_zone: updated })
}

export const DELETE = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  await validatePartnerStoreAccess(
    req.auth_context,
    req.params.id,
    req.scope
  )

  const { serviceZoneId } = req.params

  const fulfillmentService = req.scope.resolve(Modules.FULFILLMENT) as any
  await fulfillmentService.deleteServiceZones(serviceZoneId)

  res.json({
    id: serviceZoneId,
    object: "service_zone",
    deleted: true,
  })
}
