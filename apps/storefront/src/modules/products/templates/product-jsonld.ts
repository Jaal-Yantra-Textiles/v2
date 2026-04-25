import { HttpTypes } from "@medusajs/types"
import { getBaseURL } from "@lib/util/env"

type Variant = HttpTypes.StoreProductVariant & {
  calculated_price?: {
    calculated_amount?: number | null
    currency_code?: string | null
  } | null
  manage_inventory?: boolean | null
  allow_backorder?: boolean | null
  inventory_quantity?: number | null
  sku?: string | null
}

const isVariantInStock = (v: Variant): boolean => {
  if (!v.manage_inventory) return true
  if (v.allow_backorder) return true
  return (v.inventory_quantity ?? 0) > 0
}

/**
 * Build schema.org/Product JSON-LD for a product detail page.
 *
 * Prices are emitted as-is — Medusa stores calculated prices in whole
 * currency units (not minor units), so no /100 conversion is needed.
 *
 * If multiple variants exist, we emit an `AggregateOffer` with low/high
 * bounds; otherwise a single `Offer`. Availability is derived from the
 * variant's inventory flags, matching the in-stock logic used by the
 * product-actions "Add to cart" button.
 */
export const buildProductJsonLd = (
  product: HttpTypes.StoreProduct,
  opts: { countryCode?: string } = {}
): Record<string, unknown> => {
  const baseUrl = getBaseURL()
  const countryCode = opts.countryCode
  const variants = ((product.variants ?? []) as Variant[]).filter(
    (v) => !!v.calculated_price
  )

  const pricedVariants = variants
    .slice()
    .sort(
      (a, b) =>
        (a.calculated_price?.calculated_amount ?? 0) -
        (b.calculated_price?.calculated_amount ?? 0)
    )

  const cheapest = pricedVariants[0]
  const mostExpensive = pricedVariants[pricedVariants.length - 1]
  const currency =
    cheapest?.calculated_price?.currency_code?.toUpperCase() || "INR"

  const anyInStock = variants.some(isVariantInStock)
  const availability = anyInStock
    ? "https://schema.org/InStock"
    : "https://schema.org/OutOfStock"

  const offers = cheapest
    ? pricedVariants.length > 1 &&
      (cheapest.calculated_price?.calculated_amount ?? 0) !==
        (mostExpensive?.calculated_price?.calculated_amount ?? 0)
      ? {
          "@type": "AggregateOffer",
          priceCurrency: currency,
          lowPrice: cheapest.calculated_price?.calculated_amount ?? 0,
          highPrice: mostExpensive?.calculated_price?.calculated_amount ?? 0,
          offerCount: pricedVariants.length,
          availability,
        }
      : {
          "@type": "Offer",
          priceCurrency: currency,
          price: cheapest.calculated_price?.calculated_amount ?? 0,
          availability,
          ...(cheapest.sku ? { sku: cheapest.sku } : {}),
        }
    : null

  const jsonLd: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.title,
    description:
      product.description || product.subtitle || product.title || "",
    image: product.images?.map((i) => i.url) ?? [],
    brand: {
      "@type": "Brand",
      name: "Cici Label",
    },
  }

  if (product.material) jsonLd.material = product.material
  if (product.handle) {
    // Google prefers absolute URLs on the Product entity; also scope to
    // the current country so the URL matches the page's canonical.
    const pathPrefix = countryCode ? `/${countryCode}` : ""
    jsonLd.url = `${baseUrl}${pathPrefix}/products/${product.handle}`
  }

  // Use the first variant SKU as the product-level SKU identifier —
  // Google accepts this as a tie-breaker when multiple variants exist.
  const firstSku = variants.find((v) => v.sku)?.sku
  if (firstSku) jsonLd.sku = firstSku

  if (offers) jsonLd.offers = offers

  return jsonLd
}
