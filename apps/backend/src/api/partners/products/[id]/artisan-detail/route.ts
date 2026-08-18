import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { assertProductOwnership } from "../../lib/assert-product-ownership"
import { upsertArtisanProductDetailWorkflow } from "../../../../../workflows/products/upsert-artisan-product-detail"
import { ARTISAN_PRODUCT_DETAIL_MODULE } from "../../../../../modules/artisan-product-detail"
import type { PartnerArtisanProductDetailReqType } from "../../validators"

/**
 * Read the artisan detail for one of the partner's own products (#859 S3).
 *
 * @route GET /partners/products/:id/artisan-detail
 */
export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const productId = req.params.id
  await assertProductOwnership(req, productId)

  const service: any = req.scope.resolve(ARTISAN_PRODUCT_DETAIL_MODULE)
  const detail = await service.findByProduct(productId)

  return res.json({ artisan_detail: detail })
}

/**
 * Create or update the artisan "made-to-order & maker story" detail for one of
 * the partner's own products (#859 S3 / #862).
 *
 * @route POST /partners/products/:id/artisan-detail
 */
export const POST = async (
  req: AuthenticatedMedusaRequest<PartnerArtisanProductDetailReqType>,
  res: MedusaResponse
) => {
  const productId = req.params.id
  await assertProductOwnership(req, productId)

  const { result } = await upsertArtisanProductDetailWorkflow(req.scope).run({
    input: { product_id: productId, data: req.validatedBody },
  })

  return res.json({ artisan_detail: result })
}
