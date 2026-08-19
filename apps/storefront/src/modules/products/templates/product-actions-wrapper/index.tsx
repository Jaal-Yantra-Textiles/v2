import { listProducts } from "@lib/data/products"
import { HttpTypes } from "@medusajs/types"
import ProductActions from "@modules/products/components/product-actions"
import { getProductSpec } from "@lib/data/product-spec"

/**
 * Fetches real time pricing for a product and renders the product actions component.
 */
export default async function ProductActionsWrapper({
  id,
  region,
}: {
  id: string
  region: HttpTypes.StoreRegion
}) {
  // #1365 — the spec is fetched HERE, alongside pricing, so the buying column
  // arrives complete. Fetching it inside the client component would paint the
  // price and button first and then push them down as the choices appeared.
  const [product, specResponse] = await Promise.all([
    listProducts({
      queryParams: { id: [id] },
      regionId: region.id,
    }).then(({ response }) => response.products[0]),
    getProductSpec(id),
  ])

  if (!product) {
    return null
  }

  return (
    <ProductActions
      product={product}
      region={region}
      spec={specResponse.spec}
    />
  )
}
