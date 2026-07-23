import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import {
  ContainerRegistrationKeys,
  MedusaError,
  QueryContext,
  isPresent,
} from "@medusajs/framework/utils"
import { verifyPreviewToken } from "../lib/token"
import { attachMakerNames } from "../../../../../lib/attach-maker-names"

// Field set mirrors the storefront's listProducts() so ProductTemplate renders
// identically — minus anything published-only. Prices are resolved via the
// pricing QueryContext below.
const PREVIEW_FIELDS = [
  "*",
  "status",
  "*variants",
  "*variants.calculated_price",
  "*variants.options",
  "variants.images.*",
  "*options",
  "*options.values",
  // Relation expansion is `images.*`, NOT `*images` — the `*<relation>` form
  // silently fails to expand the product images (returns no `images` key), so
  // the gallery came back empty. Match the syntax used everywhere else.
  "images.*",
  "*tags",
  "*categories",
  "*collection",
  "*type",
  "+metadata",
  // The product-side alias is the linked model's name, `artisan_product_detail`
  // — NOT `artisan_detail`. defineLink's `field` option does not rename this
  // direction, so requesting `artisan_detail.*` silently returns nothing and the
  // maker story never hydrates (#859). Verified via query.graph probe.
  "artisan_product_detail.*",
]

/**
 * Token-gated preview of an unpublished (proposed/draft) artisan product (#859).
 *
 * @route GET /store/products/preview/:token?region_id=...
 *
 * Deliberately NOT a public listing: this fetches ONE product by the id encoded
 * in a signed share token, regardless of `status`, so an artisan can share a
 * private review link before an admin publishes. It is excluded from
 * `/store/products`, the sitemap, and search — the only way in is a valid
 * signed token. Requires the storefront publishable key (the storefront's
 * server fetch supplies it), same as every other `/store` route.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const productId = verifyPreviewToken(req.params.token)
  if (!productId) {
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      "Invalid or expired preview link"
    )
  }

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  // Resolve a pricing context from the caller's region so calculated_price is
  // populated (unpublished products still price normally).
  const regionId =
    (req.query.region_id as string) || (req.query.regionId as string) || ""
  let currencyCode = (req.query.currency_code as string) || ""
  if (regionId && !currencyCode) {
    const { data: regions = [] } = await query.graph({
      entity: "region",
      fields: ["id", "currency_code"],
      filters: { id: regionId },
    })
    currencyCode = regions?.[0]?.currency_code || ""
  }

  const context: Record<string, any> = {}
  if (regionId || currencyCode) {
    context["variants"] = {
      calculated_price: QueryContext({
        ...(regionId ? { region_id: regionId } : {}),
        ...(currencyCode ? { currency_code: currencyCode } : {}),
      }),
    }
  }

  const { data: products = [] } = await query.graph({
    entity: "product",
    fields: PREVIEW_FIELDS,
    filters: { id: productId },
    ...(isPresent(context) ? { context } : {}),
  })

  const product = products?.[0]
  if (!product) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      "Product not found"
    )
  }

  // Graft the owning partner's name onto artisan_detail for the "Made by …" block.
  await attachMakerNames([product], query)

  res.json({ product })
}
