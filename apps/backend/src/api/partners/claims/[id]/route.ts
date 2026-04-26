import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { validatePartnerOrderEntityOwnership } from "../../helpers"

export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  await validatePartnerOrderEntityOwnership(req.auth_context, "claim", req.params.id, req.scope)

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "order_claim",
    fields: ["*", "*additional_items", "*claim_items", "*return", "*return.items"],
    filters: { id: req.params.id } as any,
  })

  res.json({ claim: data?.[0] })
}
