import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { createProductTypesWorkflow } from "@medusajs/medusa/core-flows"
import { getPartnerFromAuthContext, getPartnerStore } from "../helpers"

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

  // Get type IDs from partner's store products via store→product link
  let partnerTypeIds: string[] = []
  try {
    const { store } = await getPartnerStore(req.auth_context, req.scope)
    const { data: storeData } = await query.graph({
      entity: "stores",
      fields: ["products.type_id"],
      filters: { id: store.id },
    })

    partnerTypeIds = [
      ...new Set(
        ((storeData?.[0] as any)?.products || [])
          .map((p: any) => p.type_id)
          .filter(Boolean) as string[]
      ),
    ]
  } catch {
    // Fallback to all types
  }

  // Return all types so partners can pick any, but they can also create new ones
  const { data: types } = await query.graph({
    entity: "product_types",
    fields: ["*"],
  }, { locale: req.locale })

  res.json({
    product_types: types || [],
    count: types?.length || 0,
    offset: 0,
    limit: 100,
  })
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

  const { result } = await createProductTypesWorkflow(req.scope).run({
    input: {
      product_types: [req.body as any],
    },
  })

  res.status(201).json({ product_type: result[0] })
}
