/**
 * Multi-tenant store resolution for the MCP server.
 *
 * Each partner runs its own storefront: partner -> store -> default sales
 * channel -> a single publishable api_key. These helpers turn a store identity
 * (handle/subdomain or domain) into that storefront's default publishable key,
 * mirroring GET /web/storefront/[subdomain]. They run natively against the
 * container (query.graph) rather than the key-gated /store/* routes, because an
 * agent must be able to ASK for a key without already having one.
 *
 * Publishable keys are public (shipped as NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY in
 * every storefront), so returning them here leaks nothing not already public.
 */
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

export type StorefrontInfo = {
  handle: string | null
  name: string | null
  domain: string | null
  store_id: string | null
  store_name: string | null
  sales_channel_id: string | null
  publishable_key: string | null
}

const PARTNER_FIELDS = [
  "handle",
  "name",
  "storefront_domain",
  "metadata",
  "stores.id",
  "stores.name",
  "stores.default_sales_channel_id",
]

const normalizeDomain = (s: string): string =>
  s
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/+$/, "")

const partnerDomain = (p: any): string | null =>
  p?.storefront_domain || p?.metadata?.storefront_domain || null

/**
 * Build a sales_channel_id -> publishable token map in one query. (api_keys
 * can't be reliably filtered by linked sales_channel, so we fetch publishable
 * keys once and index them — same approach as the storefront subdomain route.)
 */
async function buildSalesChannelKeyMap(
  query: any
): Promise<Map<string, string>> {
  const { data: apiKeys } = await query.graph({
    entity: "api_keys",
    fields: ["token", "type", "sales_channels.id"],
    filters: { type: "publishable" },
  })
  const map = new Map<string, string>()
  for (const k of apiKeys || []) {
    for (const sc of k.sales_channels || []) {
      if (sc?.id && k.token && !map.has(sc.id)) {
        map.set(sc.id, k.token)
      }
    }
  }
  return map
}

const toInfo = (p: any, keyMap: Map<string, string>): StorefrontInfo | null => {
  const store = (p?.stores || [])[0]
  if (!store) {
    return null
  }
  const scId = store.default_sales_channel_id || null
  return {
    handle: p.handle ?? null,
    name: p.name ?? null,
    domain: partnerDomain(p),
    store_id: store.id ?? null,
    store_name: store.name ?? null,
    sales_channel_id: scId,
    publishable_key: scId ? keyMap.get(scId) ?? null : null,
  }
}

/** List every live storefront (partner with a store) and its default key. */
export async function listStorefronts(
  container: any
): Promise<StorefrontInfo[]> {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data: partners } = await query.graph({
    entity: "partners",
    fields: PARTNER_FIELDS,
  })
  const keyMap = await buildSalesChannelKeyMap(query)
  return (partners || [])
    .map((p: any) => toInfo(p, keyMap))
    .filter((x: StorefrontInfo | null): x is StorefrontInfo => x !== null)
}

/**
 * Resolve a single storefront by handle (subdomain) or domain.
 * Tries: exact handle -> storefront_domain -> first domain label as handle.
 */
export async function resolveStorefront(
  container: any,
  identifier: string
): Promise<StorefrontInfo | null> {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const raw = (identifier || "").trim()
  if (!raw) {
    return null
  }
  const dom = normalizeDomain(raw)

  const byFilter = async (filters: Record<string, unknown>) => {
    const { data } = await query.graph({
      entity: "partners",
      fields: PARTNER_FIELDS,
      filters,
    })
    return (data || [])[0] || null
  }

  let partner =
    (await byFilter({ handle: raw })) || (await byFilter({ storefront_domain: dom }))

  if (!partner && dom.includes(".")) {
    partner = await byFilter({ handle: dom.split(".")[0] })
  }
  if (!partner) {
    return null
  }

  const keyMap = await buildSalesChannelKeyMap(query)
  return toInfo(partner, keyMap)
}
