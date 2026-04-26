import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError, Modules } from "@medusajs/framework/utils"
import { validatePartnerStoreAccess } from "../../../../../helpers"

export const POST = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  await validatePartnerStoreAccess(
    req.auth_context,
    req.params.id,
    req.scope
  )

  const { fulfillmentSetId } = req.params
  const body = req.body as Record<string, any>

  const fulfillmentService = req.scope.resolve(Modules.FULFILLMENT) as any
  const serviceZone = await fulfillmentService.createServiceZones({
    ...body,
    fulfillment_set_id: fulfillmentSetId,
  })

  res.status(201).json({ service_zone: serviceZone })
}
