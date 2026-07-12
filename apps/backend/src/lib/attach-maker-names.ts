import partnerProductLink from "../links/partner-product"

/**
 * Enrich store products with the owning partner's name as
 * `artisan_product_detail.maker_name` (#859) so the storefront can render
 * "Made by <partner>" on the maker-story block.
 *
 * The maker is the partner that owns the product via the partner↔product link;
 * the name isn't on the product or the artisan detail row, so we resolve it here
 * and graft it onto the response object (not a real DB field). The relation is
 * keyed by the linked model's name, `artisan_product_detail` (NOT
 * `artisan_detail` — defineLink's `field` option doesn't rename this side).
 * Only products that already carry that relation are touched, and it's just two
 * batched graph queries for the whole page, so it's cheap and a no-op for
 * non-artisan catalogs.
 *
 * Mutates the passed products in place (and returns them for convenience).
 */
export async function attachMakerNames<
  T extends { id?: string; artisan_product_detail?: any }
>(products: T[], query: any): Promise<T[]> {
  const targets = products.filter((p) => p?.id && p.artisan_product_detail)
  if (!targets.length) return products

  const productIds = targets.map((p) => p.id as string)

  const { data: links = [] } = await query.graph({
    entity: partnerProductLink.entryPoint,
    fields: ["product_id", "partner_id"],
    filters: { product_id: productIds },
  })

  const productToPartner = new Map<string, string>()
  for (const l of links as any[]) {
    if (l?.product_id && l?.partner_id && !productToPartner.has(l.product_id)) {
      productToPartner.set(l.product_id, l.partner_id)
    }
  }
  if (!productToPartner.size) return products

  const partnerIds = [...new Set(productToPartner.values())]
  const { data: partners = [] } = await query.graph({
    entity: "partners",
    fields: ["id", "name"],
    filters: { id: partnerIds },
  })
  const partnerName = new Map(
    (partners as any[]).map((p) => [p.id, p.name])
  )

  for (const p of targets) {
    const partnerId = productToPartner.get(p.id as string)
    const name = partnerId ? partnerName.get(partnerId) : undefined
    if (
      name &&
      p.artisan_product_detail &&
      typeof p.artisan_product_detail === "object"
    ) {
      p.artisan_product_detail.maker_name = name
    }
  }

  return products
}
