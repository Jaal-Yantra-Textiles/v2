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

/** Map a tool name to a domain, or undefined if it is cross-cutting (e.g. load_*_tools). */
export function toolNameToDomain(toolName: string): string | undefined {
  if (toolName.startsWith("load_")) return undefined
  if (toolName === "get_admin_stats" || toolName === "get_partner_profile") return undefined
  if (toolName === "resolve_admin_query") return undefined
  if (toolName === "read_image" || toolName === "describe_image") return undefined
  if (toolName === "extract_inventory_from_image") return "inventory"

  for (const [re, domain] of DOMAIN_PATTERNS) {
    if (re.test(toolName)) return domain
  }
  return undefined
}
