/**
 * UCP context — resolves publishable key, loopback URL, and store info
 * for each UCP request. Reuses the MCP store-resolver for multi-tenancy.
 */

import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import {
  resolveStorefront,
  findStorefrontByKey,
  type StorefrontInfo,
} from "../../mcp/lib/store-resolver"

/**
 * Resolve the storefront a UCP request is scoped to. A caller-supplied
 * publishable key pins the request to that partner (or core) storefront; with no
 * key we fall back to the platform core store. Returns null only if resolution
 * fails entirely (callers then fall back to env/host defaults).
 */
async function resolveScopedStorefront(
  container: any,
  callerKey: string | undefined
): Promise<StorefrontInfo | null> {
  try {
    const byKey = callerKey ? await findStorefrontByKey(container, callerKey) : null
    return byKey || (await resolveStorefront(container, "default"))
  } catch {
    return null
  }
}

export type UcpContext = {
  baseUrl: string
  publishableKey: string | undefined
  container: any
  storeName: string
  storefrontUrl: string
  /** Store's default region — used for price/tax context when caller omits one. */
  defaultRegionId: string | undefined
  /** Store's default currency code (lowercase, e.g. "eur"). */
  storeCurrency: string | undefined
}

const PUBLISHABLE_HEADER = "x-publishable-api-key"

export function resolveBaseUrl(req: any): string {
  const override = process.env.STORE_MCP_LOOPBACK_URL
  if (override) return override.replace(/\/$/, "")
  const proto = (req.protocol || "http").split(",")[0].trim()
  const host = req.get("host")
  if (host) return `${proto}://${host}`
  const port = process.env.PORT || "9000"
  return `http://localhost:${port}`
}

export function resolvePublicUrl(req: any): string {
  return process.env.STOREFRONT_URL || `${req.protocol}://${req.get("host")}`
}

/**
 * Canonical storefront URL for buyer-facing links (product pages, terms, order
 * permalinks). Prefers the resolved core store's own domain (e.g.
 * https://cicilabel.com) over the API host or STOREFRONT_URL env, so links point
 * at the shopper's storefront and never at the backend/API origin.
 */
export async function resolveStorefrontUrl(
  container: any,
  req: any,
  callerKey?: string
): Promise<string> {
  const info = await resolveScopedStorefront(container, callerKey)
  if (info?.domain) return `https://${info.domain}`
  return resolvePublicUrl(req)
}

export async function buildUcpContext(req: any): Promise<UcpContext> {
  const container = req.scope
  const baseUrl = resolveBaseUrl(req)
  const storefrontUrl = resolvePublicUrl(req)

  const callerKey =
    req.get(PUBLISHABLE_HEADER) ||
    (req as any).publishable_key_context?.key ||
    undefined

  // Resolve the storefront this request is scoped to: the caller's publishable
  // key pins it to that partner (via sales-channel → store → partner link), else
  // the platform core store. Name, URL, region, currency and the fallback key all
  // come from this single storefront so a partner request stays fully consistent.
  const info = await resolveScopedStorefront(container, callerKey)

  const storeName = info?.name || info?.store_name || process.env.STORE_NAME || "JYT Store"
  const resolvedStorefrontUrl = info?.domain ? `https://${info.domain}` : storefrontUrl
  const defaultRegionId = info?.default_region_id || undefined
  const storeCurrency = info?.currency_code || undefined

  // Precedence: caller-supplied key > explicit env override > resolved store key.
  // Without this, an unkeyed catalog request returns zero products because
  // /store/* requires a publishable key for sales-channel scoping.
  const publishableKey =
    callerKey || process.env.STORE_MCP_DEFAULT_PUBLISHABLE_KEY || info?.publishable_key || undefined

  return {
    baseUrl,
    publishableKey,
    container,
    storeName,
    storefrontUrl: resolvedStorefrontUrl,
    defaultRegionId,
    storeCurrency,
  }
}

/**
 * Region resolution — find a region that serves a given country.
 */
export async function findRegionForCountry(
  scope: any,
  countryCode: string
): Promise<{ id: string; name: string; currency_code: string } | null> {
  const query = scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data: regions } = await query.graph({
    entity: "region",
    fields: ["id", "name", "currency_code", "countries.iso_2"],
  })

  for (const region of regions || []) {
    const codes = (region.countries || []).map((c: any) => c.iso_2?.toLowerCase())
    if (codes.includes(countryCode.toLowerCase())) {
      return { id: region.id, name: region.name, currency_code: region.currency_code }
    }
  }
  return null
}

/** Find a region by its currency code (first match). */
export async function findRegionForCurrency(
  scope: any,
  currency: string
): Promise<{ id: string; currency_code: string } | null> {
  const query = scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data: regions } = await query.graph({
    entity: "region",
    fields: ["id", "currency_code"],
    filters: { currency_code: currency.toLowerCase() },
  })
  const r = (regions || [])[0]
  return r ? { id: r.id, currency_code: r.currency_code } : null
}

export type CatalogPriceContext = {
  /** Query params to forward to /store/products for price/tax context. */
  query: Record<string, string>
  /** Resolved presentment currency (uppercase ISO 4217), for the formatter. */
  currency: string | undefined
}

/**
 * Resolve the pricing context for a catalog request into (a) the Medusa query
 * params that make /store/products compute calculated prices and (b) the
 * presentment currency the response should be denominated in. Honors, in order:
 * country → currency → explicit region_id → the store's default region.
 */
export async function resolveCatalogPriceContext(
  scope: any,
  ctx: UcpContext,
  reqCtx: any
): Promise<CatalogPriceContext> {
  const country = reqCtx?.address_country || reqCtx?.country_code
  const currency = reqCtx?.currency
  const regionId = reqCtx?.region_id

  // 1. Country hint — resolve to a region so we also learn its currency.
  if (country) {
    const region = await findRegionForCountry(scope, country)
    if (region) {
      return { query: { region_id: region.id }, currency: region.currency_code?.toUpperCase() }
    }
    // Unknown country — let Medusa try to resolve it, currency unknown.
    return { query: { country_code: String(country).toLowerCase() }, currency: currency?.toUpperCase() }
  }

  // 2. Explicit currency hint — map to a region carrying that currency.
  if (currency) {
    const region = await findRegionForCurrency(scope, currency)
    if (region) {
      return { query: { region_id: region.id }, currency: region.currency_code.toUpperCase() }
    }
    // No region for that currency; still surface the requested currency.
    return { query: {}, currency: currency.toUpperCase() }
  }

  // 3. Explicit region id.
  if (regionId) {
    return { query: { region_id: regionId }, currency: ctx.storeCurrency?.toUpperCase() }
  }

  // 4. Store default region.
  return {
    query: ctx.defaultRegionId ? { region_id: ctx.defaultRegionId } : {},
    currency: ctx.storeCurrency?.toUpperCase(),
  }
}

/**
 * Resolve UCP category filter values (category `value`s = names, or raw pcat_
 * ids) into Medusa category ids for the /store/products `category_id` filter.
 * Unresolvable names are dropped.
 */
export async function resolveCategoryIds(
  scope: any,
  values: string[]
): Promise<string[]> {
  const ids = values.filter((v) => v.startsWith("pcat_"))
  const names = values.filter((v) => !v.startsWith("pcat_"))
  if (names.length) {
    const query = scope.resolve(ContainerRegistrationKeys.QUERY)
    const { data: cats } = await query.graph({
      entity: "product_category",
      fields: ["id"],
      filters: { name: names },
    })
    for (const c of cats || []) ids.push(c.id)
  }
  return Array.from(new Set(ids))
}

export async function getSupportedCountries(scope: any): Promise<string[]> {
  const query = scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data: regions } = await query.graph({
    entity: "region",
    fields: ["countries.iso_2"],
  })

  const set = new Set<string>()
  for (const region of regions || []) {
    for (const c of region.countries || []) {
      if (c.iso_2) set.add(c.iso_2.toLowerCase())
    }
  }
  return Array.from(set).sort()
}

export async function resolveRegionForAddressUpdate(
  scope: any,
  cartId: string,
  countryCode: string
): Promise<
  | { supported: true; regionId: string; shouldSwitch: boolean }
  | { supported: false; supportedCountries: string[] }
> {
  const query = scope.resolve(ContainerRegistrationKeys.QUERY)
  const [{ data: [cart] }, match] = await Promise.all([
    query.graph({ entity: "cart", fields: ["id", "region_id"], filters: { id: cartId } }),
    findRegionForCountry(scope, countryCode),
  ])

  if (!match) {
    return { supported: false, supportedCountries: await getSupportedCountries(scope) }
  }

  const shouldSwitch = cart && cart.region_id !== match.id
  return { supported: true, regionId: match.id, shouldSwitch }
}
