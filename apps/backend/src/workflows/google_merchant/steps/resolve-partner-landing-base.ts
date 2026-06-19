import type { RemoteQueryFunction } from "@medusajs/types"

/**
 * #377 — Google Merchant: derive a product's landing-page base URL from the
 * partner storefront that owns it, instead of always using a single global
 * base (`landing_url_base` on the merchant account / `STORE_URL`).
 *
 * Resolution order for the base, matching the roadmap issue:
 *   1. partner.metadata.custom_domain   (attached custom domain — primary)
 *   2. partner.metadata.website_domain  (legacy alias key)
 *   3. partner.storefront_domain        (the *.cicilabel.com subdomain)
 *
 * Product → partner pivot mirrors the FX fanout work:
 *   product → sales_channels → store (default_sales_channel_id) → partner
 *   (partner_stores link). sales_channel ↔ store is NOT a Medusa link
 *   (store.default_sales_channel_id is a plain column), so it's resolved
 *   with an explicit second query rather than a dot-path join.
 *
 * Domains are stored bare (e.g. "gof.asia", "acme.cicilabel.com"); the
 * serving convention everywhere else is `https://<host>` (see
 * set-storefront-base-url.ts), so we normalize to that.
 */

type Queryable = Pick<Omit<RemoteQueryFunction, symbol>, "graph">

/**
 * Normalize a bare or schemed domain into a clean `https://<host>` base with
 * no trailing slash. Returns null for empty / unusable input.
 */
export function normalizeLandingBase(value?: string | null): string | null {
  if (!value) return null
  let v = String(value).trim()
  if (!v) return null
  // Strip any path/trailing slash noise but keep an explicit scheme.
  if (!/^https?:\/\//i.test(v)) {
    v = `https://${v}`
  }
  // Drop trailing slashes (the caller appends `/products/<handle>`).
  v = v.replace(/\/+$/, "")
  return v || null
}

/**
 * Pure precedence over a partner-like record's domain fields.
 * Exported for unit testing without a query layer.
 */
export function partnerBaseFromRecord(
  partner: {
    storefront_domain?: string | null
    metadata?: Record<string, any> | null
  } | null | undefined
): string | null {
  if (!partner) return null
  const meta = partner.metadata || {}
  return (
    normalizeLandingBase(meta.custom_domain) ||
    normalizeLandingBase(meta.website_domain) ||
    normalizeLandingBase(partner.storefront_domain)
  )
}

/**
 * #521 — abandoned-cart recovery link. A cart carries `sales_channel_id`
 * directly, so we can pivot straight from the channel (skipping the product
 * step of {@link resolvePartnerLandingBase}):
 *
 *   sales_channel → store (default_sales_channel_id) → partner (partner_stores)
 *
 * Returns the owning partner's identity + normalized storefront base so the
 * admin abandoned-cart view can show who owns the cart and build a recovery
 * link that points at THAT partner's storefront instead of a single global
 * `STORE_URL`. Never throws — returns null when nothing matches so callers can
 * fall back to the env base.
 */
export async function resolvePartnerStorefrontForSalesChannel(
  query: Queryable,
  sales_channel_id?: string | null
): Promise<{
  id: string
  name: string | null
  handle: string | null
  storefront_base: string | null
} | null> {
  if (!sales_channel_id) return null
  try {
    // 1. sales_channel → store (default_sales_channel_id is a plain column).
    const { data: stores } = await query.graph({
      entity: "stores",
      fields: ["id", "default_sales_channel_id"],
      filters: { default_sales_channel_id: [sales_channel_id] },
    } as any)
    const storeIds = new Set((stores ?? []).map((s: any) => s?.id).filter(Boolean))
    if (!storeIds.size) return null

    // 2. store → partner (partner_stores link). Filters don't auto-join
    //    dot-paths, so match owner in JS (mirrors resolvePartnerLandingBase).
    const { data: partners } = await query.graph({
      entity: "partners",
      fields: ["id", "name", "handle", "storefront_domain", "metadata", "stores.id"],
    } as any)
    const owner = (partners ?? []).find((p: any) =>
      (p?.stores ?? []).some((st: any) => storeIds.has(st?.id))
    )
    if (!owner) return null
    return {
      id: owner.id,
      name: owner.name ?? null,
      handle: owner.handle ?? null,
      storefront_base: partnerBaseFromRecord(owner),
    }
  } catch {
    return null
  }
}

/**
 * Resolve the landing base for a single product from its owning partner
 * storefront. Returns null (never throws) when the product isn't tied to a
 * partner store or no domain is configured, so callers can fall back to the
 * account-level / env base.
 */
export async function resolvePartnerLandingBase(
  query: Queryable,
  product_id: string
): Promise<string | null> {
  try {
    // 1. product → sales_channels
    const { data: products } = await query.graph({
      entity: "product",
      fields: ["id", "sales_channels.id"],
      filters: { id: product_id },
    } as any)
    const channelIds: string[] = (products?.[0]?.sales_channels ?? [])
      .map((sc: any) => sc?.id)
      .filter(Boolean)
    if (!channelIds.length) return null

    // 2. sales_channel → store (default_sales_channel_id is a plain column).
    const { data: stores } = await query.graph({
      entity: "stores",
      fields: ["id", "default_sales_channel_id"],
      filters: { default_sales_channel_id: channelIds },
    } as any)
    const storeIds = new Set((stores ?? []).map((s: any) => s?.id).filter(Boolean))
    if (!storeIds.size) return null

    // 3. store → partner (partner_stores link). Filters don't auto-join
    //    dot-paths, so fetch partners with their store ids + domain fields
    //    and match in JS (mirrors propagate-region-to-partners).
    const { data: partners } = await query.graph({
      entity: "partners",
      fields: ["id", "storefront_domain", "metadata", "stores.id"],
    } as any)
    const owner = (partners ?? []).find((p: any) =>
      (p?.stores ?? []).some((st: any) => storeIds.has(st?.id))
    )
    return partnerBaseFromRecord(owner)
  } catch {
    return null
  }
}
