/**
 * #2349 S4 — what a product card in the Email tab carries, and the link it
 * points at. Pure so the price label and the UTM-tagged link are unit-tested.
 */

/** The house storefront. Its middleware adds the visitor's country and keeps the query string. */
export const SHOP_ORIGIN = "https://cicilabel.com"

/** Same fallback the send path uses when a post has no slug (build-email-data.ts). */
const FALLBACK_CAMPAIGN = "blog_broadcast"

export type ProductCardAttrs = {
  productId: string | null
  handle: string | null
  title: string
  imageUrl: string | null
  /** e.g. "₹2,500" or "From $40". Null when the product has no price in the chosen currency. */
  priceLabel: string | null
  buttonLabel: string
}

type PricedVariant = {
  prices?: Array<{ amount?: number | null; currency_code?: string | null } | null> | null
} | null

type PickableProduct = {
  id: string
  title?: string | null
  handle?: string | null
  thumbnail?: string | null
  images?: Array<{ url?: string | null } | null> | null
  variants?: PricedVariant[] | null
}

/**
 * The lowest price across variants in one currency. Medusa 2 stores major
 * units (2500 = ₹2,500). "From" only when variants are priced differently.
 */
export const formatPriceLabel = (
  variants: PricedVariant[] | null | undefined,
  currencyCode: string
): string | null => {
  const code = currencyCode.toLowerCase()
  const amounts = (variants ?? [])
    .flatMap((v) => v?.prices ?? [])
    .filter((p) => p?.currency_code?.toLowerCase() === code && typeof p.amount === "number")
    .map((p) => p!.amount as number)
  if (!amounts.length) return null

  const min = Math.min(...amounts)
  const max = Math.max(...amounts)
  const formatted = new Intl.NumberFormat(code === "inr" ? "en-IN" : "en-US", {
    style: "currency",
    currency: code.toUpperCase(),
    maximumFractionDigits: Number.isInteger(min) ? 0 : 2,
  }).format(min)
  return max > min ? `From ${formatted}` : formatted
}

export const productCardFromProduct = (
  product: PickableProduct,
  currencyCode: string
): ProductCardAttrs => ({
  productId: product.id,
  handle: product.handle ?? null,
  title: product.title ?? "",
  imageUrl: product.thumbnail || product.images?.find((i) => i?.url)?.url || null,
  priceLabel: formatPriceLabel(product.variants, currencyCode),
  buttonLabel: "Shop now",
})

/**
 * The card's Shop link. Tagged like every other newsletter link
 * (utm_source=newsletter, utm_medium=email, utm_campaign=<post slug>);
 * utm_content says the click came from a product card. A card without a
 * handle links to the shop's front page rather than a 404.
 */
export const productCardHref = (handle: string | null | undefined, campaign?: string | null): string => {
  const base = handle ? `${SHOP_ORIGIN}/products/${encodeURIComponent(handle)}` : SHOP_ORIGIN
  const params = new URLSearchParams({
    utm_source: "newsletter",
    utm_medium: "email",
    utm_campaign: campaign?.trim() || FALLBACK_CAMPAIGN,
    utm_content: "product_card",
  })
  return `${base}?${params.toString()}`
}
