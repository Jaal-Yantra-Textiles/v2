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
    for (const groupId of body.add) {
      await remoteLink.create({
        customer: { customer_id: req.params.id },
        customer_group: { customer_group_id: groupId },
      })
    }
  }

  if (body.remove?.length) {
    for (const groupId of body.remove) {
      await remoteLink.dismiss({
        customer: { customer_id: req.params.id },
        customer_group: { customer_group_id: groupId },
      })
    }
  }

  res.json({ customer: { id: req.params.id } })
}
