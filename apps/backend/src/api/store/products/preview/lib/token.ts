import crypto from "crypto"

/**
 * Share-token signing for artisan product previews (#859).
 *
 * A `core_channel_listing` partner's product enters as `proposed` and is NOT
 * returned by `/store/products` (published-only) nor listed anywhere public.
 * To let the partner share a private "review this before it goes live" link, we
 * mint a stateless signed token — `<productId>.<hmac>` — that a dedicated
 * preview endpoint verifies. No schema change, no DB lookup: possession of the
 * signed link is the capability. Anyone without the signature cannot guess it
 * even if they know the product id.
 */

const secret = (): string =>
  process.env.PRODUCT_PREVIEW_SECRET ||
  process.env.JWT_SECRET ||
  process.env.COOKIE_SECRET ||
  "insecure-preview-secret-change-me"

const sign = (productId: string): string =>
  crypto
    .createHmac("sha256", secret())
    .update(productId)
    .digest("base64url")

/** Build the `<productId>.<sig>` share token for a product. */
export const signPreviewToken = (productId: string): string =>
  `${productId}.${sign(productId)}`

/**
 * Verify a share token and return its product id, or null if malformed /
 * tampered. Uses a constant-time comparison to avoid signature-timing leaks.
 */
export const verifyPreviewToken = (token: string): string | null => {
  if (!token || typeof token !== "string") {
    return null
  }
  const idx = token.lastIndexOf(".")
  if (idx <= 0) {
    return null
  }
  const productId = token.slice(0, idx)
  const provided = token.slice(idx + 1)
  const expected = sign(productId)

  const a = Buffer.from(provided)
  const b = Buffer.from(expected)
  if (a.length !== b.length) {
    return null
  }
  return crypto.timingSafeEqual(a, b) ? productId : null
}
