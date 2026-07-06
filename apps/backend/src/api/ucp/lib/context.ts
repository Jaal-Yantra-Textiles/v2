/**
 * UCP context — resolves publishable key, loopback URL, and store info
 * for each UCP request. Reuses the MCP store-resolver for multi-tenancy.
 */

import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { resolveStorefront, type StorefrontInfo } from "../../mcp/lib/store-resolver"

export type UcpContext = {
  baseUrl: string
  publishableKey: string | undefined
  container: any
  storeName: string
  storefrontUrl: string
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

export async function buildUcpContext(req: any): Promise<UcpContext> {
  const container = req.scope
  const baseUrl = resolveBaseUrl(req)
  const storefrontUrl = resolvePublicUrl(req)

  const callerKey =
    req.get(PUBLISHABLE_HEADER) ||
    (req as any).publishable_key_context?.key ||
    undefined
  const publishableKey = callerKey || process.env.STORE_MCP_DEFAULT_PUBLISHABLE_KEY

  let storeName = process.env.STORE_NAME || "JYT Store"
  let resolvedStorefrontUrl = storefrontUrl

  // Try to resolve store info for the name/URL
  try {
    const info: StorefrontInfo | null = await resolveStorefront(container, "default")
    if (info) {
      storeName = info.name || info.store_name || storeName
      if (info.domain) {
        resolvedStorefrontUrl = `https://${info.domain}`
      }
    }
  } catch {
    // Fall back to env defaults
  }

  return {
    baseUrl,
    publishableKey,
    container,
    storeName,
    storefrontUrl: resolvedStorefrontUrl,
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
