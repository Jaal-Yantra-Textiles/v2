import { MedusaError } from "@medusajs/framework/utils"

/**
 * Shared storefront-resolution helpers for the public `/web/storefront/*`
 * routes. Given a partner (already fetched with `stores.*`), walk
 * partner → store → default sales channel → publishable API key. This is the
 * chain the multi-tenant storefront middleware relies on to turn an incoming
 * `Host` into the publishable key it must send to the Store API.
 */

export type ResolvedStorefront = {
  partner: { name: string; handle: string | null; logo: string | null }
  store: { id: string; name: string; default_region_id: string | null }
  publishable_key: string | null
  sales_channel_id: string
}

// Query surface we depend on — the Medusa remote-query `graph` method.
type QueryLike = {
  graph: (config: {
    entity: string
    fields: string[]
    filters?: Record<string, unknown>
  }) => Promise<{ data: any[] }>
}

/**
 * Resolve a fetched partner row into its storefront's publishable key.
 * Throws NOT_FOUND when the partner has no store or no sales channel — the
 * same behaviour as the legacy `[subdomain]` route.
 */
export async function resolveStorefrontForPartner(
  query: QueryLike,
  partner: any
): Promise<ResolvedStorefront> {
  const stores = partner.stores || []
  if (!stores.length) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `No store configured for partner '${partner.handle ?? partner.id}'`
    )
  }

  const store = stores[0]
  const salesChannelId = store?.default_sales_channel_id
  if (!salesChannelId) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `No sales channel configured for partner '${partner.handle ?? partner.id}'`
    )
  }

  // Find the publishable key linked to this sales channel.
  const { data: apiKeys } = await query.graph({
    entity: "api_keys",
    fields: ["*", "sales_channels.*"],
    filters: { type: "publishable" },
  })

  const matchingKey = (apiKeys || []).find((key: any) =>
    (key.sales_channels || []).some((sc: any) => sc.id === salesChannelId)
  )

  return {
    partner: {
      name: partner.name,
      handle: partner.handle ?? null,
      logo: partner.metadata?.logo || null,
    },
    store: {
      id: store.id,
      name: store.name,
      default_region_id: store.default_region_id ?? null,
    },
    publishable_key: matchingKey?.token || null,
    sales_channel_id: salesChannelId,
  }
}

/**
 * Normalize a raw `Host` header into lookup candidates:
 * - `host`: lowercased, port stripped, leading `www.` removed.
 * - `subdomain`: the first label when the host has 3+ labels
 *   (`acme.jaalyantra.com` → `acme`), else null (apex/custom domains).
 */
export function hostToCandidates(rawHost: string): {
  host: string
  subdomain: string | null
} {
  const host = (rawHost || "")
    .toLowerCase()
    .split(":")[0]
    .replace(/^www\./, "")
    .trim()
  const labels = host.split(".").filter(Boolean)
  const subdomain = labels.length > 2 ? labels[0] : null
  return { host, subdomain }
}
