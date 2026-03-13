import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, MedusaError, Modules } from "@medusajs/framework/utils"
import { validatePartnerStoreAccess } from "../../../../helpers"
import { PartnerUpdateShippingOptionReq } from "../../validators"

export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  await validatePartnerStoreAccess(
    req.auth_context,
    req.params.id,
    req.scope
  )

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data: options } = await query.graph({
    entity: "shipping_options",
    fields: ["*", "prices.*", "rules.*", "type.*", "shipping_profile.*"],
    filters: { id: req.params.optionId },
  })

  if (!options?.[0]) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      "Shipping option not found"
    )
  }

  res.json({ shipping_option: options[0] })
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

  const body = PartnerUpdateShippingOptionReq.parse(req.body)

  const fulfillmentService = req.scope.resolve(Modules.FULFILLMENT) as any
  const updated = await fulfillmentService.updateShippingOptions(
    req.params.optionId,
    body
  )

  res.json({ shipping_option: updated })
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

  const fulfillmentService = req.scope.resolve(Modules.FULFILLMENT) as any
  await fulfillmentService.deleteShippingOptions([req.params.optionId])

  res.json({ id: req.params.optionId, object: "shipping_option", deleted: true })
}
