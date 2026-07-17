import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { resolveStorefrontForPartner } from "../resolve-key"

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const { subdomain } = req.params
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  // Look up partner by handle
  const { data: partners } = await query.graph({
    entity: "partners",
    fields: ["id", "name", "handle", "storefront_domain", "metadata", "stores.*"],
    filters: { handle: subdomain },
  })

  if (!partners?.length) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Storefront not found for subdomain '${subdomain}'`
    )
  }

  const resolved = await resolveStorefrontForPartner(query, partners[0])

  res.status(200).json(resolved)
}
