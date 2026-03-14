import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { getPartnerFromAuthContext } from "../helpers"

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

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data: tags } = await query.graph({
    entity: "product_tags",
    fields: ["*"],
  })

  res.json({
    product_tags: tags || [],
    count: tags?.length || 0,
    offset: 0,
    limit: 20,
  })
}
