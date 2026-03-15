import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, MedusaError, Modules } from "@medusajs/framework/utils"
import { deleteProductVariantsWorkflow } from "@medusajs/medusa/core-flows"
import { validatePartnerStoreAccess } from "../../../../../../helpers"

export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  await validatePartnerStoreAccess(
    req.auth_context,
    req.params.id,
    req.scope
  )

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data: variants } = await query.graph({
    entity: "product_variants",
    fields: ["*", "prices.*", "options.*", "inventory_items.*"],
    filters: { id: req.params.variantId },
  })

  if (!variants?.[0]) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, "Variant not found")
  }

  res.json({ variant: variants[0] })
}

export const POST = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  await validatePartnerStoreAccess(
    req.auth_context,
    req.params.id,
    req.scope
  )

  const body = req.body as Record<string, any>
  const productService = req.scope.resolve(Modules.PRODUCT) as any
  const updated = await productService.updateProductVariants(
    req.params.variantId,
    body
  )

  res.json({ variant: updated })
}

export const DELETE = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  await validatePartnerStoreAccess(
    req.auth_context,
    req.params.id,
    req.scope
  )

  await deleteProductVariantsWorkflow(req.scope).run({ input: { ids: [req.params.variantId] } })

  res.json({ id: req.params.variantId, object: "product_variant", deleted: true })
}
