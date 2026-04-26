import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { updateStoresWorkflow } from "@medusajs/medusa/core-flows"
import { validatePartnerStoreAccess } from "../../helpers"

export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const { store } = await validatePartnerStoreAccess(
    req.auth_context,
    req.params.id,
    req.scope
  )

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  // Enrich store with related entities including nested currency details
  const { data: stores } = await query.graph({
    entity: "stores",
    fields: [
      "*",
      "supported_currencies.*",
      "supported_currencies.currency.*",
    ],
    filters: { id: store.id },
  })

  res.json({ store: stores?.[0] || store })
}

export const POST = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const { store } = await validatePartnerStoreAccess(
    req.auth_context,
    req.params.id,
    req.scope
  )

  const body = req.body as Record<string, any>

  const { result } = await updateStoresWorkflow(req.scope).run({
    input: {
      selector: { id: store.id },
      update: body,
    },
  })

  res.json({ store: result?.[0] || result })
}
