import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { batchVariantImagesWorkflow } from "@medusajs/medusa/core-flows"
import { validatePartnerStoreAccess } from "../../../../../../../../helpers"

type BatchVariantImagesBody = {
  add?: string[]
  remove?: string[]
}

export const POST = async (
  req: AuthenticatedMedusaRequest<BatchVariantImagesBody>,
  res: MedusaResponse
) => {
  await validatePartnerStoreAccess(req.auth_context, req.params.id, req.scope)

  const body = (req.validatedBody ?? (req.body as BatchVariantImagesBody)) ?? {}

  const { result } = await batchVariantImagesWorkflow(req.scope).run({
    input: {
      variant_id: req.params.variantId,
      add: Array.isArray(body.add) ? body.add : [],
      remove: Array.isArray(body.remove) ? body.remove : [],
    },
  })

  res.status(200).json({
    added: result.added,
    removed: result.removed,
  })
}
