import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { createProductTagsWorkflow } from "@medusajs/medusa/core-flows"
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

  // Get tag IDs from partner's store products
  let partnerTagIds: string[] = []
  try {
    const { store } = await getPartnerStore(req.auth_context, req.scope)
    const { data: storeData } = await query.graph({
      entity: "stores",
      fields: ["products.tags.id"],
      filters: { id: store.id },
    })

    partnerTagIds = [
      ...new Set(
        ((storeData?.[0] as any)?.products || [])
          .flatMap((p: any) => (p.tags || []).map((t: any) => t.id))
          .filter(Boolean) as string[]
      ),
    ]
  } catch {
    // Fallback to all tags
  }

  // Return all tags — partners can use any existing or create new
  const { data: tags } = await query.graph({
    entity: "product_tags",
    fields: ["*"],
  })

  res.json({
    product_tags: tags || [],
    count: tags?.length || 0,
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

  const { result } = await createProductTagsWorkflow(req.scope).run({
    input: {
      product_tags: [req.body as any],
    },
  })

  res.status(201).json({ product_tag: result[0] })
}
