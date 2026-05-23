import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import {
  deleteShippingOptionsWorkflow,
  updateShippingOptionsWorkflow,
} from "@medusajs/medusa/core-flows"
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

  // Use updateShippingOptionsWorkflow rather than the bare fulfillment
  // service. Shipping option prices live in the pricing module and are
  // linked to the option via a remote price_set link — the fulfillment
  // service has no knowledge of that link, so passing a `prices` field
  // through it returns 200 but silently drops every price. The workflow
  // updates the option AND its linked price_set in one go (same path the
  // standard admin uses).
  await updateShippingOptionsWorkflow(req.scope).run({
    input: [
      {
        id: req.params.optionId,
        ...body,
      } as any,
    ],
  })

  // Refetch with prices so the client gets the full updated shape — the
  // workflow result alone doesn't include the resolved price rows.
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data: options } = await query.graph({
    entity: "shipping_options",
    fields: ["*", "prices.*", "prices.price_rules.*", "rules.*", "type.*", "shipping_profile.*"],
    filters: { id: req.params.optionId },
  })

  if (!options?.[0]) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, "Shipping option not found")
  }

  res.json({ shipping_option: options[0] })
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

  await deleteShippingOptionsWorkflow(req.scope).run({ input: { ids: [req.params.optionId] } })

  res.json({ id: req.params.optionId, object: "shipping_option", deleted: true })
}
