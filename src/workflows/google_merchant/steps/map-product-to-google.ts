import { GoogleMerchantProductPayload } from "../../../modules/google_merchant/provider"

export interface MapOptions {
  offerId: string
  link: string
  contentLanguage: string
  feedLabel: string
  currencyCode: string
}

export function mapProductToGoogleMerchant(
  product: any,
  options: MapOptions
): GoogleMerchantProductPayload {
  const variant = product.variants?.[0]
  const priceRecord =
    variant?.prices?.find((p: any) => p.currency_code?.toUpperCase() === options.currencyCode.toUpperCase()) ||
    variant?.prices?.[0]

  const amountMicros = priceRecord?.amount
    ? String(Math.round(Number(priceRecord.amount) * 10_000))
    : undefined

  const images: string[] = (product.images || []).map((img: any) => img.url).filter(Boolean)

  const stockQuantity = variant?.inventory_quantity ?? 1
  const availability: GoogleMerchantProductPayload["availability"] = stockQuantity > 0 ? "in_stock" : "out_of_stock"

  return {
    offerId: options.offerId,
    title: product.title || "Untitled Product",
    description: product.description || product.subtitle || product.title || "",
    link: options.link,
    imageLink: images[0],
    additionalImageLinks: images.slice(1, 11),
    contentLanguage: options.contentLanguage,
    feedLabel: options.feedLabel,
    availability,
    condition: "new",
    price: amountMicros
      ? { amountMicros, currencyCode: (priceRecord?.currency_code || options.currencyCode).toUpperCase() }
      : undefined,
    brand: product.metadata?.brand as string | undefined,
    gtin: product.metadata?.gtin as string | undefined,
    mpn: product.metadata?.mpn as string | undefined,
  }
}

export function validateProductForGoogle(product: any): { valid: boolean; error?: string } {
  if (!product.title) return { valid: false, error: "Product title is required" }
  if (!product.handle) return { valid: false, error: "Product handle is required (used for landing URL)" }
  const variant = product.variants?.[0]
  if (!variant) return { valid: false, error: "Product must have at least one variant" }
  const amount = variant.prices?.[0]?.amount
  if (!amount || Number(amount) <= 0) return { valid: false, error: "Product must have a valid price" }
  if (!product.images || product.images.length === 0) {
    return { valid: false, error: "Product must have at least one image" }
  }
  return { valid: true }
}
