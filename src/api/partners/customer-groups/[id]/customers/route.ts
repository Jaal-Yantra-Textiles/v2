import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { getPartnerStore } from "../../../helpers"

export const POST = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  await getPartnerStore(req.auth_context, req.scope)

  const body = req.body as any
  const remoteLink = req.scope.resolve(ContainerRegistrationKeys.LINK) as any

  if (body.add?.length) {
    for (const customerId of body.add) {
      await remoteLink.create({
        customer_group: { customer_group_id: req.params.id },
        customer: { customer_id: customerId },
      })
    }
  }

  if (body.remove?.length) {
    for (const customerId of body.remove) {
      await remoteLink.dismiss({
        customer_group: { customer_group_id: req.params.id },
        customer: { customer_id: customerId },
      })
    }
  }

  res.json({ customer_group: { id: req.params.id } })
}
