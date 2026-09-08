import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import productDesignLink from "../../../../../links/product-design-link"

/**
 * GET /admin/designs/:id/products — which products came from this design.
 *
 * There was no way to ask this. `create-product-from-design` writes a
 * product↔design link row and stamps `metadata.design_id` on the product, but
 * nothing read either direction: `get_design` returns no products and
 * `/admin/products` cannot filter on metadata. Finding the product for a design
 * meant free-text searching titles — which, when it was tried on production,
 * happened to work only because the generated `custom-design-…` handle matched;
 * two of the twelve had titles that did not contain the search string at all.
 *
 * 🔑 Queried through the LINK's `entryPoint`, not from the design entity. A
 * `query.graph` from an entity to a linked field returns no key at all rather
 * than erroring, so reading it the obvious way looks exactly like "this design
 * has no products".
 */
export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
): Promise<void> => {
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  const { data } = await query.graph({
    entity: productDesignLink.entryPoint,
    fields: [
      "product.id",
      "product.title",
      "product.handle",
      "product.status",
      "product.thumbnail",
      "product.created_at",
      "product.metadata",
      "product.variants.id",
      "product.variants.title",
      "product.variants.sku",
      "product.variants.prices.amount",
      "product.variants.prices.currency_code",
    ],
    filters: { design_id: req.params.id },
  })

  // A link row whose product was hard-deleted resolves to a null `product`.
  // Reporting it as a product with no id would be worse than omitting it.
  const products = (data || [])
    .map((row: any) => row?.product)
    .filter((p: any) => p && p.id)

  res.status(200).json({ products, count: products.length })
}
