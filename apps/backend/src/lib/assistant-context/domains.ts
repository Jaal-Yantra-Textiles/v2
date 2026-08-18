/**
 * Tool-name → domain classification shared by both assistant surfaces.
 *
 * The tool-slice modules classify tools by route prefix for registry slicing,
 * but context extraction runs AFTER the turn completes — we only have tool
 * NAMES (from the AI SDK's onFinish callback), not the route defs. This maps
 * a tool name to a domain using the same vocabulary, so context is cached
 * under the same domain key the slicer activates on.
 *
 * Deliberately generous — a false negative just skips the cache entry for
 * that tool, which is harmless. A false positive would put context under the
 * wrong domain key, which is slightly misleading but never dangerous because
 * the injection is advisory ("you previously found..."), not authoritative.
 */

import { ADMIN_MCP_TOOLS } from "../../api/admin/mcp/lib/registry"
import { PARTNER_MCP_TOOLS } from "../../api/partners/mcp/lib/registry"
import {
  toolDomain as adminToolDomain,
  SELECTABLE_DOMAINS as ADMIN_SELECTABLE_DOMAINS,
} from "../../api/admin/mcp/lib/tool-slice"
import {
  toolDomain as partnerToolDomain,
  SELECTABLE_DOMAINS as PARTNER_SELECTABLE_DOMAINS,
} from "../../api/partners/mcp/lib/tool-slice"

/** Which assistant a turn belongs to. */
export type AssistantSurface = "admin" | "partner"

const DOMAIN_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  [/order|fulfil|fulfill|shipment|shipping|deliver|waybill|awb|return|refund|claim|exchange/i, "orders"],
  [/product(?!ion)|variant|catalog|customs|hsn|hs_code|listing|discover/i, "catalog"],
  [/customer|buyer|shopper/i, "customers"],
  [/partner|seller|manufacturer|artisan|vendor|onboard|whatsapp|subscription|commission/i, "partners"],
  [/design|tech.?pack|construction|inspiration|pinterest|moodboard|colourway|colorway|revision|brief/i, "designs"],
  [/production|run|dispatch|task|template|manufactur/i, "production"],
  [/inventory|stock|raw.?material|fabric|warehouse|location|restock|reservation|swatch|bolt|roll|delivery.?note|moq/i, "inventory"],
  [/payment|payout|invoice|revenue|settle|money|balance/i, "money"],
  [/campaign|newsletter|notification|social|publish|reel|caption|hashtag|fbinsta/i, "marketing"],
  [/store|storefront|website|domain|provision|deploy|seed|sales.?channel|tax.?region/i, "storefront"],
  [/mcp|observ|telemetry|ledger|audit|maintenance|backfill|repair|reconcil/i, "observability"],
]

/**
 * The domains each surface's SLICER can actually select.
 *
 * This is the half the heuristic alone gets wrong. The regex list above is one
 * vocabulary; each slicer has its own, and they are NOT the same set — `admin`
 * has no `storefront` domain (its `/admin/stores` tools classify as `catalog`)
 * and `partner` has no `partners`, `marketing` or `observability`. A row
 * written under a domain the reader can never ask for is invisible: the cache
 * looks like it simply did not help.
 *
 * Rather than hand-maintain a third vocabulary, the lookup below asks each
 * REGISTRY what a tool's domain is — the same classification the slicer uses —
 * and only falls back to the regexes for a name no registry knows.
 */
const SURFACE_DOMAINS: Record<AssistantSurface, ReadonlySet<string>> = {
  admin: new Set(ADMIN_SELECTABLE_DOMAINS as readonly string[]),
  partner: new Set(PARTNER_SELECTABLE_DOMAINS as readonly string[]),
}

/** tool name -> domain, per surface, built once from the registries. */
const REGISTRY_DOMAINS: Record<AssistantSurface, Map<string, string>> = {
  admin: new Map(
    ADMIN_MCP_TOOLS.map((t) => [t.name, adminToolDomain(t) ?? ""]).filter(
      ([, d]) => !!d && d !== "core"
    ) as [string, string][]
  ),
  partner: new Map(
    PARTNER_MCP_TOOLS.map((t) => [t.name, partnerToolDomain(t) ?? ""]).filter(
      ([, d]) => !!d && d !== "core"
    ) as [string, string][]
  ),
}

/**
 * Map a tool name to a domain, or undefined if it is cross-cutting (e.g.
 * load_*_tools) or belongs to no domain this surface can ask for.
 *
 * Pass `surface` wherever it is known — without it the heuristic answers alone
 * and can name a domain the reader will never request.
 */
export function toolNameToDomain(
  toolName: string,
  surface?: AssistantSurface
): string | undefined {
  if (toolName.startsWith("load_")) return undefined
  if (toolName === "get_admin_stats" || toolName === "get_partner_profile") return undefined
  if (toolName === "resolve_admin_query") return undefined
  if (toolName === "read_image" || toolName === "describe_image") return undefined
  if (toolName === "extract_inventory_from_image") return "inventory"

  // The registry IS the slicer's classification, so a hit here can never be a
  // domain the read path cannot ask for.
  if (surface) {
    const known = REGISTRY_DOMAINS[surface].get(toolName)
    if (known) return known
  }

  for (const [re, domain] of DOMAIN_PATTERNS) {
    if (re.test(toolName)) {
      // A heuristic answer still has to be a domain this surface selects.
      if (surface && !SURFACE_DOMAINS[surface].has(domain)) return undefined
      return domain
    }
  }
  return undefined
}
