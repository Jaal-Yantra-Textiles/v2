import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import {
  ContainerRegistrationKeys,
  MedusaError,
  Modules,
} from "@medusajs/framework/utils"
import { deleteShippingOptionTypesWorkflow } from "@medusajs/medusa/core-flows"
import { getPartnerFromAuthContext } from "../../helpers"

export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const partner = await getPartnerFromAuthContext(req.auth_context, req.scope)
  if (!partner) {
    throw new MedusaError(
      MedusaError.Types.UNAUTHORIZED,
      "No partner associated with this account"
    )
  }

  const { id } = req.params
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data: types } = await query.graph({
    entity: "shipping_option_type",
    fields: ["*"],
    filters: { id },
  })

  if (!types?.length) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Shipping option type ${id} not found`
    )
  }

  res.json({ shipping_option_type: types[0] })
}

export const POST = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const partner = await getPartnerFromAuthContext(req.auth_context, req.scope)
  if (!partner) {
    throw new MedusaError(
      MedusaError.Types.UNAUTHORIZED,
      "No partner associated with this account"
    )
  }

  const { id } = req.params
  const fulfillmentService = req.scope.resolve(Modules.FULFILLMENT)
  const updated = await fulfillmentService.updateShippingOptionTypes(
    id,
    req.body as any,
  )

  res.json({ shipping_option_type: updated })
}

export const DELETE = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const partner = await getPartnerFromAuthContext(req.auth_context, req.scope)
  if (!partner) {
    throw new MedusaError(
      MedusaError.Types.UNAUTHORIZED,
      "No partner associated with this account"
    )
  }

  const { id } = req.params
  await deleteShippingOptionTypesWorkflow(req.scope).run({ input: { ids: [id] } })

  res.json({ id, object: "shipping_option_type", deleted: true })
}
