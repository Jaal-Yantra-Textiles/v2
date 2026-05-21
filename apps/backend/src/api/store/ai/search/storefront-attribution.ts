/**
 * Storefront attribution for product search hits.
 *
 * The product catalogue contains items from both the main JYT/Cici Label
 * storefront AND partner storefronts (each partner has their own
 * sales channel + Vercel deployment). The same vector index serves both,
 * so a search hit could be a product whose canonical storefront isn't
 * the one the user is currently browsing — clicking it would 404.
 *
 * This helper tags each hit with whether the canonical storefront is
 * "main" (link locally via LocalizedClientLink) or "partner" (link out
 * to the partner's domain) so the UI can render the right destination
 * and a visible badge.
 *
 * Attribution logic:
 *   - If any of the product's sales channels is NOT mapped to a
 *     partner's default sales channel → kind = "main". The current
 *     storefront can resolve the URL.
 *   - If every sales channel is partner-owned → kind = "partner", with
 *     the first matching partner's name + domain attached.
 *
 * The partner → sales-channel map is cached in-process for 30s. The
 * mapping doesn't change often (creating/dissolving a partner storefront
 * is rare) and a stale read here is harmless — at worst we briefly
 * misclassify a product, which the next refresh corrects.
 */
import type { MedusaContainer } from "@medusajs/framework"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

export type StorefrontAttribution =
  | { kind: "main" }
  | {
      kind: "partner"
      url?: string
      partner_name: string
      partner_handle: string
      sales_channel_name?: string
    }

type PartnerInfo = {
  name: string
  handle: string
  storefront_domain: string | null
}

let partnerScCache: Map<string, PartnerInfo> = new Map()
let partnerScCacheTs = 0
const CACHE_TTL_MS = 30_000

const buildPartnerSalesChannelMap = async (
  container: MedusaContainer
): Promise<Map<string, PartnerInfo>> => {
  const now = Date.now()
  if (partnerScCache.size > 0 && now - partnerScCacheTs < CACHE_TTL_MS) {
    return partnerScCache
  }
  const query = container.resolve(ContainerRegistrationKeys.QUERY) as any
  const map = new Map<string, PartnerInfo>()
  try {
    const { data } = await query.graph({
      entity: "partners",
      fields: [
        "id",
        "name",
        "handle",
        "storefront_domain",
        "metadata",
        "stores.id",
        "stores.default_sales_channel_id",
      ],
    })
    for (const p of (data ?? []) as any[]) {
      const domain =
        p.storefront_domain ?? p.metadata?.storefront_domain ?? null
      for (const s of (p.stores ?? []) as any[]) {
        const scId = s?.default_sales_channel_id
        if (!scId) continue
        map.set(scId, {
          name: p.name ?? "Partner",
          handle: p.handle ?? "",
          storefront_domain: domain,
        })
      }
    }
  } catch (e) {
    // If the lookup fails, downstream callers see an empty map and
    // every product gets kind: "main" — safer than crashing the search.
    console.warn(
      "[storefront-attribution] partner map refresh failed:",
      (e as any)?.message ?? e
    )
  }
  partnerScCache = map
  partnerScCacheTs = now
  return map
}

const buildPartnerUrl = (
  domain: string | null,
  productHandle: string
): string | undefined => {
  if (!domain || !productHandle) return undefined
  const stripped = String(domain).replace(/^https?:\/\//, "").replace(/\/+$/, "")
  if (!stripped) return undefined
  // Partner storefronts use the same Next.js template, so /products/<handle>
  // resolves. No country code in the URL — partner storefronts are
  // single-locale today.
  return `https://${stripped}/products/${encodeURIComponent(productHandle)}`
}

type ProductWithChannels = {
  id: string
  handle: string
  sales_channels?: Array<{ id: string; name?: string }> | null
}

export const attachStorefrontAttribution = async <
  P extends ProductWithChannels
>(
  products: P[],
  container: MedusaContainer
): Promise<Array<P & { storefront: StorefrontAttribution }>> => {
  if (!products.length) return [] as any
  const partnerMap = await buildPartnerSalesChannelMap(container)

  return products.map((p) => {
    const channels = p.sales_channels ?? []
    let firstPartner:
      | { partner: PartnerInfo; sc: { id: string; name?: string } }
      | null = null
    let hasMain = false
    for (const sc of channels) {
      const partner = partnerMap.get(sc.id)
      if (partner) {
        if (!firstPartner) firstPartner = { partner, sc }
      } else {
        hasMain = true
      }
    }

    if (hasMain || !firstPartner) {
      return { ...p, storefront: { kind: "main" as const } }
    }
    const { partner, sc } = firstPartner
    return {
      ...p,
      storefront: {
        kind: "partner" as const,
        url: buildPartnerUrl(partner.storefront_domain, p.handle),
        partner_name: partner.name,
        partner_handle: partner.handle,
        sales_channel_name: sc.name,
      },
    }
  })
}
