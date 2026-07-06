/**
 * Multi-tenant store resolution for the MCP server.
 *
 * The platform runs many partner storefronts (partner -> store -> default sales
 * channel -> a single publishable api_key) PLUS its own core store (the apex
 * cicilabel.com store, not linked to any partner). These helpers list every
 * store and turn a store identity (handle/subdomain, domain, or "default") into
 * that store's default publishable key.
 *
 * It is **store-first**: we enumerate the `store` entity (like core
 * GET /admin/stores does) and join partner handle/domain on top, so EVERY store
 * is returned — including the core store that iterating partners alone misses.
 * Runs natively against the container (query.graph), not the key-gated /store/*
 * routes, because an agent must be able to ASK for a key without already having
 * one.
 *
 * Publishable keys are public (shipped as NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY in
 * every storefront), so returning them here leaks nothing not already public.
 */
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

export type StorefrontInfo = {
  /** Partner handle/subdomain, or null for the platform core store. */
  handle: string | null
  name: string | null
  domain: string | null
  store_id: string | null
  store_name: string | null
  sales_channel_id: string | null
  default_region_id: string | null
  default_location_id: string | null
  /** Default currency code (the store's is_default supported currency). */
  currency_code: string | null
  publishable_key: string | null
  /**
   * True for the platform's own store — i.e. a store NOT linked to any partner
   * (the apex cicilabel.com store). Partner storefronts are false.
   */
  is_default: boolean
}

// Mirrors core defaultAdminStoreFields (api/admin/stores/query-config) so the
// MCP sees the same rich store shape the admin does.
const STORE_FIELDS = [
  "id",
  "name",
  "default_sales_channel_id",
  "default_region_id",
  "default_location_id",
  "supported_currencies.currency_code",
  "supported_currencies.is_default",
  "metadata",
]

const PARTNER_FIELDS = ["handle", "name", "storefront_domain", "metadata", "stores.id"]

const normalizeDomain = (s: string): string =>
  s
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/+$/, "")

const partnerDomain = (p: any): string | null =>
  p?.storefront_domain || p?.metadata?.storefront_domain || null

/**
 * Apex domain of the platform's own (core) store. Partner storefronts live on
 * `*.cicilabel.com` subdomains; the bare apex is the core store. Mirrors the
 * `ROOT_DOMAIN` convention used by the storefront provisioning scripts.
 */
const defaultStoreDomain = (): string | null => {
  const d = (
    process.env.STORE_MCP_DEFAULT_STORE_DOMAIN ||
    process.env.ROOT_DOMAIN ||
    "cicilabel.com"
  ).trim()
  return d ? normalizeDomain(d) : null
}

const defaultCurrency = (store: any): string | null => {
  const currencies = store?.supported_currencies || []
  const def = currencies.find((c: any) => c?.is_default) || currencies[0]
  return def?.currency_code ?? null
}

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

/** Assemble one StorefrontInfo from a store row + its owning partner (or null). */
const buildInfo = (
  store: any,
  partner: any | null,
  keyMap: Map<string, string>
): StorefrontInfo => {
  const scId = store?.default_sales_channel_id || null
  return {
    handle: partner?.handle ?? null,
    name: partner?.name ?? store?.name ?? null,
    domain: partner ? partnerDomain(partner) : defaultStoreDomain(),
    store_id: store?.id ?? null,
    store_name: store?.name ?? null,
    sales_channel_id: scId,
    default_region_id: store?.default_region_id ?? null,
    default_location_id: store?.default_location_id ?? null,
    currency_code: defaultCurrency(store),
    publishable_key: scId ? keyMap.get(scId) ?? null : null,
    is_default: !partner,
  }
}

/**
 * List every storefront and its default publishable key — store-first, so the
 * platform core store is always included alongside partner storefronts. The
 * core/default store(s) come first.
 */
export async function listStorefronts(
  container: any
): Promise<StorefrontInfo[]> {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const [{ data: stores }, { data: partners }] = await Promise.all([
    query.graph({ entity: "stores", fields: STORE_FIELDS }),
    query.graph({ entity: "partners", fields: PARTNER_FIELDS }),
  ])
  const keyMap = await buildSalesChannelKeyMap(query)

  // store_id -> owning partner (a store linked to a partner is a partner store).
  const storeIdToPartner = new Map<string, any>()
  for (const p of partners || []) {
    for (const s of p?.stores || []) {
      if (s?.id) {
        storeIdToPartner.set(s.id, p)
      }
    }
  }

  const infos = (stores || []).map((s: any) =>
    buildInfo(s, storeIdToPartner.get(s.id) || null, keyMap)
  )
  // Core/default store(s) first, then partner storefronts.
  return infos.sort(
    (a: StorefrontInfo, b: StorefrontInfo) =>
      Number(b.is_default) - Number(a.is_default)
  )
}

/**
 * Resolve the storefront that owns a given sales channel (a cart's
 * `sales_channel_id`). Used to derive a checkout's return-URL origin.
 */
export async function findStorefrontBySalesChannel(
  container: any,
  salesChannelId: string | null | undefined
): Promise<StorefrontInfo | null> {
  if (!salesChannelId) {
    return null
  }
  const all = await listStorefronts(container)
  return all.find((s) => s.sales_channel_id === salesChannelId) ?? null
}

/**
 * Resolve the storefront that owns a given publishable key token. Maps a
 * caller-supplied `x-publishable-api-key` back to its partner/core store so
 * requests can be scoped dynamically (name, domain, region) to that storefront.
 */
export async function findStorefrontByKey(
  container: any,
  token: string | null | undefined
): Promise<StorefrontInfo | null> {
  if (!token) {
    return null
  }
  const all = await listStorefronts(container)
  return all.find((s) => s.publishable_key === token) ?? null
}

/**
 * Resolve a single storefront. Matches (in order): partner handle, exact domain,
 * store id, default sales-channel id, store name, the first domain label as a
 * handle, then the platform core store via "default"/"main" or the apex domain.
 */
export async function resolveStorefront(
  container: any,
  identifier: string
): Promise<StorefrontInfo | null> {
  const raw = (identifier || "").trim()
  if (!raw) {
    return null
  }
  const lower = raw.toLowerCase()
  const dom = normalizeDomain(raw)
  const apex = defaultStoreDomain()

  const all = await listStorefronts(container)

  const direct = all.find(
    (s) =>
      (s.handle && s.handle.toLowerCase() === lower) ||
      (s.domain && s.domain === dom) ||
      s.store_id === raw ||
      s.sales_channel_id === raw ||
      (s.store_name && s.store_name.toLowerCase() === lower) ||
      (dom.includes(".") &&
        s.handle &&
        s.handle.toLowerCase() === dom.split(".")[0])
  )
  if (direct) {
    return direct
  }

  // Fall through to the platform core store.
  const isDefaultKeyword = lower === "default" || lower === "main"
  const isApex = !!apex && (dom === apex || lower === apex)
  if (isDefaultKeyword || isApex) {
    return all.find((s) => s.is_default) ?? null
  }

  return null
}
