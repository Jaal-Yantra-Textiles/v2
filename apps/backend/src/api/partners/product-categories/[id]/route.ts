import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import {
  updateProductCategoriesWorkflow,
  deleteProductCategoriesWorkflow,
} from "@medusajs/medusa/core-flows"
import { validatePartnerEntityOwnership } from "../../helpers"

export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  await validatePartnerEntityOwnership(
    req.auth_context,
    "product_categories",
    req.params.id,
    req.scope
  )

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "product_category",
    fields: [
      "id",
      "name",
      "handle",
      "description",
      "is_active",
      "is_internal",
      "rank",
      "metadata",
      "created_at",
      "updated_at",
      "parent_category.*",
      "category_children.*",
      "products.*",
    ],
    filters: { id: req.params.id },
  })

  res.json({ product_category: data[0] })
}

export const POST = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  await validatePartnerEntityOwnership(
    req.auth_context,
    "product_categories",
    req.params.id,
    req.scope
  )

  const { result } = await updateProductCategoriesWorkflow(req.scope).run({
    input: {
      selector: { id: req.params.id },
      update: req.body as any,
    },
  })

  res.json({ product_category: result[0] })
}

export const DELETE = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const { store } = await validatePartnerEntityOwnership(
    req.auth_context,
    "product_categories",
    req.params.id,
    req.scope
  )

  // Dismiss the link first
  const remoteLink = req.scope.resolve(ContainerRegistrationKeys.LINK) as any
  await remoteLink.dismiss({
    [Modules.STORE]: { store_id: store.id },
    [Modules.PRODUCT]: { product_category_id: req.params.id },
  })

  await deleteProductCategoriesWorkflow(req.scope).run({
    input: [req.params.id],
  })

  res.status(200).json({ id: req.params.id, object: "product_category", deleted: true })
}
