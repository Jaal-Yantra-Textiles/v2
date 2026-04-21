import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { batchProductVariantsWorkflow } from "@medusajs/medusa/core-flows"
import { validatePartnerStoreAccess } from "../../../../../../helpers"

export const POST = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  await validatePartnerStoreAccess(
    req.auth_context,
    req.params.id,
    req.scope
  )

  const productId = req.params.productId
  const body = (req.body ?? {}) as Record<string, any>

  const input = {
    create: body.create?.map((c: any) => ({ ...c, product_id: productId })),
    update: body.update?.map((u: any) => ({ ...u, product_id: productId })),
    delete: body.delete,
  }

  const { result } = await batchProductVariantsWorkflow(req.scope).run({
    input,
  })

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  const createdIds = result.created?.map((v: any) => v.id) ?? []
  const updatedIds = result.updated?.map((v: any) => v.id) ?? []

  const variantFields = [
    "*",
    "product_id",
    "prices.*",
    "options.*",
    "options.option.*",
    "inventory_items.*",
  ]

  let created: any[] = []
  let updated: any[] = []

  if (createdIds.length) {
    const { data } = await query.graph({
      entity: "product_variants",
      fields: variantFields,
      filters: { id: createdIds },
    })
    created = data as any[]
  }

  if (updatedIds.length) {
    const { data } = await query.graph({
      entity: "product_variants",
      fields: variantFields,
      filters: { id: updatedIds },
    })
    updated = data as any[]
  }

  res.json({
    created,
    updated,
    deleted: {
      ids: result.deleted ?? [],
      object: "product_variant",
      deleted: true,
    },
  })
}
