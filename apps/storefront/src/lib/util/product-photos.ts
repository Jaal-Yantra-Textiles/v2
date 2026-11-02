/**
 * Whether a product has at least one usable photo.
 *
 * ONE rule for every surface that changes when photos are missing: the
 * product page swaps its gallery for the "listing in progress" journey, the
 * buy button holds the sale ("Photos coming soon"), and product cards show a
 * "Photoshoot in progress" placeholder. It reads only the product data, so the
 * moment a photo is uploaded every surface returns to normal on its own. No
 * flag to set, nothing to remember to turn off.
 *
 * A photo counts when `thumbnail` or any `images[].url` is a non-blank string.
 */
export type ProductPhotoSource = {
  thumbnail?: string | null
  images?: ({ url?: string | null } | null | undefined)[] | null
}

const isUsableUrl = (value: unknown): boolean =>
  typeof value === "string" && value.trim().length > 0

export function hasProductPhotos(
  product: ProductPhotoSource | null | undefined
): boolean {
  if (!product) return false
  if (isUsableUrl(product.thumbnail)) return true
  return (product.images ?? []).some((image) => isUsableUrl(image?.url))
}
