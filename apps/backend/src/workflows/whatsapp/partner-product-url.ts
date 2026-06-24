/**
 * Build an absolute partner-portal product-detail URL.
 *
 * The WhatsApp product-create confirmation messages are sent to the PARTNER,
 * who can only open the partner portal (partner.jaalyantra.com) — never the
 * admin app (v3.jaalyantra.com/app/...). This helper centralises the one true
 * partner product link so both construction sites stay in sync.
 *
 * Base resolution (first non-empty wins):
 *   1. explicit `base` arg
 *   2. env PARTNER_APP_URL          (the env named in #707)
 *   3. env PARTNER_PORTAL_URL       (existing partner-deeplink convention)
 *   4. https://partner.jaalyantra.com (hard default)
 *
 * Path mirrors the partner-ui product-detail route
 * (apps/partner-ui/src/dashboard-app/routes/get-partner-route.map.tsx →
 * `/products/:id`), which is NOT the admin `/app/products/:id`.
 */
export function buildPartnerProductUrl(productId: string, base?: string): string {
  const resolved =
    (base && base.trim()) ||
    process.env.PARTNER_APP_URL ||
    process.env.PARTNER_PORTAL_URL ||
    "https://partner.jaalyantra.com"
  return `${resolved.replace(/\/$/, "")}/products/${productId}`
}
