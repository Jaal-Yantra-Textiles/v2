/**
 * Per-ask registry slicing for the partner assistant.
 *
 * Mirrors the admin tool-slice (see ../../admin/mcp/lib/tool-slice) for the
 * Partner surface. The partner registry is ~178 tools — larger than admin's —
 * and the in-app assistant re-sends every bound tool definition on EVERY turn,
 * so registry size is both the dominant per-request token cost and (because the
 * free-model rotator ranks by context length) a lever on which model answers.
 *
 * This module maps each partner tool to a domain and picks the domains an ask
 * actually needs. The chat route binds the full registry (so every tool stays
 * callable) but passes only the slice as `activeTools`, so only those
 * definitions are serialised to the provider.
 *
 * Nothing here can make a tool permanently unreachable: the always-on core
 * includes the onboarding/breadth reads, and the chat route widens the slice
 * mid-run when the model asks for a domain it wasn't given. Getting the slice
 * wrong costs a round trip, not a capability.
 */
import type { McpToolDef } from "../../../../lib/mcp-core"
// Submodule, not the barrel — see the admin slicer for why.
import { widenedDomainsFromHistory as sharedWidenedDomainsFromHistory } from "../../../../lib/mcp-core/tool-slice"

export type PartnerToolDomain =
  | "core"
  | "orders"
  | "catalog"
  | "storefront"
  | "designs"
  | "production"
  | "inventory"
  | "customers"
  | "money"

/**
 * Route prefix -> domain. Longest prefix wins, so a more specific entry is
 * never shadowed by a broader one. The `/` guard in `toolDomain` means a
 * prefix only matches itself or a path segment under it — `/partners/me` does
 * NOT swallow `/partners/medias`. A new registry row under an existing prefix
 * is classified automatically; a genuinely new route family needs one line
 * here (and the invariant test below fails loudly until it gets one).
 */
const PREFIX_DOMAINS: ReadonlyArray<readonly [string, PartnerToolDomain]> = [
  // ---- core: identity, onboarding, UI, reference data, cross-cutting ----
  ["/partners/me", "core"],
  ["/partners/update", "core"],
  ["/partners/onboarding-profile", "core"],
  ["/partners/details", "core"],
  ["/partners/layouts", "core"],
  ["/partners/currencies", "core"],
  // Media uploads are cross-cutting (design references, product photos,
  // storefront assets) so they must be reachable from any conversation.
  ["/partners/medias", "core"],
  // AI vision + usage are cross-cutting — describe an image for a design OR a
  // product, check own usage from anywhere.
  ["/partners/ai", "core"],
  ["/partners/notifications", "core"],

  // ---- orders: fulfilment + the whole post-purchase lifecycle ----
  ["/partners/orders", "orders"],
  ["/partners/order-edits", "orders"],
  ["/partners/returns", "orders"],
  ["/partners/claims", "orders"],
  ["/partners/exchanges", "orders"],
  // Refund / return reasons are reference data FOR the orders slice — an
  // operator creating a return needs the reason slug, so they ride together.
  ["/partners/refund-reasons", "orders"],
  ["/partners/return-reasons", "orders"],

  // ---- catalog: the partner's own product record + taxonomy ----
  ["/partners/products", "catalog"],
  ["/partners/product-categories", "catalog"],
  ["/partners/product-collections", "catalog"],
  ["/partners/product-tags", "catalog"],
  ["/partners/product-types", "catalog"],
  ["/partners/price-preferences", "catalog"],
  // discover = "copy a product from another store into mine" — it operates on
  // the partner's catalog, so it belongs here next to create_product.
  ["/partners/discover", "catalog"],

  // ---- storefront: store channels + the public site + store configuration ----
  ["/partners/stores", "storefront"],
  ["/partners/storefront", "storefront"],

  // Sub-trees of /partners/stores that belong to ANOTHER domain by meaning.
  //
  // Longest-prefix wins, so these override the "/partners/stores" line above.
  // They exist because a domain is only useful if the words a partner would use
  // for a tool select the domain that OWNS it, and the store sub-tree is where
  // route shape and vocabulary part company hardest:
  //
  //   - store products/variants ARE the partner's products. "update the price
  //     of my product", "list my variants" and "bulk update" all say product,
  //     never "store", so they must land in `catalog` alongside create_product.
  //   - HS/HSN codes are a customs question about those same products.
  //   - a store "location" is a stock location — the tool's own description
  //     says "Location / warehouse name", which is the inventory vocabulary.
  //   - payment providers are a money question.
  //
  // What stays `storefront` is the genuine store CONFIGURATION surface: the
  // public site, regions, shipping options, tax regions and sales channels.
  ["/partners/stores/:id/products", "catalog"],
  ["/partners/stores/:id/product-variants", "catalog"],
  ["/partners/stores/:id/customs", "catalog"],
  ["/partners/stores/:id/locations", "inventory"],
  ["/partners/stores/:id/payment-providers", "money"],

  // ---- designs: the design record + cost / consumption / media ----
  ["/partners/designs", "designs"],

  // ---- production: run lifecycle + run-level cost & consumption + run tasks ----
  // /partners/tasks and /partners/assigned-tasks are the per-task view onto a
  // production run (accept/finish a dispatched task), so they ride the
  // production slice — an ask about a task is an ask about a run.
  ["/partners/production-runs", "production"],
  ["/partners/tasks", "production"],
  ["/partners/assigned-tasks", "production"],

  // ---- inventory: items, levels, raw materials, inventory orders, reservations ----
  ["/partners/inventory-items", "inventory"],
  ["/partners/inventory-orders", "inventory"],
  ["/partners/reservations", "inventory"],

  // ---- customers: the partner's buyers + groups ----
  ["/partners/customers", "customers"],
  ["/partners/customer-groups", "customers"],

  // ---- money: payments, providers, submissions, payment collections ----
  ["/partners/payments", "money"],
  ["/partners/payment-providers", "money"],
  ["/partners/payment-submissions", "money"],
  ["/partners/payment-collections", "money"],
]

/** The route family (PREFIX_DOMAINS entry) a tool matched — longest wins. */
const matchPrefix = (
  path: string
): readonly [string, PartnerToolDomain] | undefined => {
  let best: readonly [string, PartnerToolDomain] | undefined
  for (const entry of PREFIX_DOMAINS) {
    const [prefix] = entry
    if (
      (path === prefix || path.startsWith(`${prefix}/`)) &&
      (!best || prefix.length > best[0].length)
    ) {
      best = entry
    }
  }
  return best
}

/** Classify one tool by the route it wraps. */
export function toolDomain(def: McpToolDef): PartnerToolDomain | undefined {
  const path = def.path
  if (!path) return "core" // native tools are grounding/discovery
  return matchPrefix(path)?.[1]
}

/**
 * The route family a tool belongs to — its matched prefix, or "native" for the
 * pathless grounding tools.
 *
 * Exported for the vocabulary-coverage invariant: classification alone does not
 * make a tool reachable, so the suite asserts every FAMILY has a phrasing that
 * selects it. A new route family therefore fails the suite twice over until it
 * has both a prefix and words a partner would actually type.
 */
export function toolRouteFamily(def: McpToolDef): string {
  const path = def.path
  if (!path) return "native"
  return matchPrefix(path)?.[0] ?? "unclassified"
}

/**
 * Trigger words per domain, matched case-insensitively on word boundaries
 * against the recent conversation text. Deliberately generous — a false
 * positive costs a few hundred tokens, a false negative costs a round trip.
 */
const DOMAIN_KEYWORDS: Record<Exclude<PartnerToolDomain, "core">, string[]> = {
  orders: [
    "order", "orders", "fulfil", "fulfill", "fulfilment", "fulfillment",
    "ship", "shipped", "shipping", "shipment", "deliver", "delivered",
    "delivery", "courier", "awb", "waybill", "label", "tracking", "cancel",
    "refund", "return", "returns", "claim", "claims", "exchange", "exchanges",
    "line item", "line items", "mark as delivered", "mark delivered",
    "order edit", "order edits", "edit order", "request edit", "confirm edit",
  ],
  catalog: [
    "product", "products", "variant", "variants", "sku", "catalog",
    "catalogue", "category", "categories", "collection", "collections",
    "tag", "tags", "product type", "product types", "price", "prices",
    "pricing", "price preference", "price preferences", "price list",
    "discover", "copy product", "artisan", "artisan detail", "resubmit",
    // Store product listings classify here (see PREFIX_DOMAINS), so the
    // listing vocabulary belongs with them.
    "store product", "product listing", "product listings",
    "store product variant", "listing", "listings",
    // Bulk store-product edits are the partner's "update all my products"
    // path; without these the one tool that can serve it never loads.
    "bulk", "in bulk", "all products", "every product", "all my products",
    "bulk update",
    // Customs codes are set ON products (/partners/stores/:id/customs), and a
    // partner asks about them in customs words, never product ones. Mirrors
    // the admin slicer, which carries the same list for /admin/customs.
    "hsn", "hs code", "hs codes", "hs_code", "customs", "harmonized",
    "harmonised", "tariff", "duty", "commodity code",
  ],
  storefront: [
    "store", "stores", "storefront", "website", "web site", "page", "pages",
    "block", "blocks", "domain", "provision", "provisioning", "deploy",
    "redeploy", "seed", "region", "regions",
    "homepage", "home page", "landing", "hero",
    // Store CONFIGURATION. Without these the shipping-option / tax-region /
    // sales-channel tools have no phrasing that reaches them: "shipping" alone
    // selects `orders`, whose tools are order fulfilment, not store setup.
    "shipping option", "shipping options", "delivery option",
    "delivery options", "tax", "taxes", "tax region", "tax regions",
    "sales channel", "sales channels", "channel", "channels",
  ],
  designs: [
    "design", "designs", "designer", "moodboard", "tech pack", "techpack",
    "size set", "size sets", "sizing", "measurement", "measurements",
    "colourway", "colorway", "revision", "revisions", "bom",
    "bill of materials", "consumption", "consumption log", "consumption logs",
    "cost", "recalculate", "design media", "reference", "reference image",
  ],
  production: [
    "production", "production run", "production runs", "run", "runs",
    "accept", "accept run", "start", "start run", "finish", "finish run",
    "complete", "complete run", "decline", "decline run", "cost summary",
    "manufacture", "manufacturing", "in progress", "wip",
    "task", "tasks", "assigned task", "assigned tasks", "accept task",
    "finish task",
  ],
  inventory: [
    "inventory", "stock", "stocks", "raw material", "raw materials",
    "material", "materials", "fabric", "yarn", "warehouse", "location",
    "restock", "purchase order", "reservation", "reservations",
    "material group", "material groups", "swatch", "swatches", "trim", "trims",
    "bolt", "bolts", "roll", "rolls", "composition", "gsm", "yardage",
    "meterage", "delivery note", "packing list", "unit cost", "moq",
    "inventory order", "inventory orders", "inventory level", "stock level",
  ],
  customers: [
    "customer", "customers", "buyer", "buyers", "shopper", "shoppers",
    "group", "groups", "customer group", "customer groups", "address",
  ],
  money: [
    "payment", "payments", "payout", "payouts", "invoice", "invoices",
    "revenue", "settle", "settlement", "money", "paid", "unpaid", "balance",
    "submission", "payment submission", "payment provider", "payment providers",
    "payment collection", "payment collections", "mark as paid", "collect payment",
  ],
}

/**
 * Always sent, regardless of the ask: the onboarding grounding, the partner's
 * own detail record, and the cheap top-level list read for each domain. Those
 * list_* tools are what let an unclassifiable ask ("what's going on with my
 * shop?") still get somewhere, and they give the model the vocabulary to
 * widen the slice deliberately.
 */
export const ALWAYS_ON_TOOLS: readonly string[] = [
  "get_partner_profile",
  "get_onboarding_profile",
  "get_partner_details",
  "list_orders",
  "list_products",
  "list_stores",
  "list_designs",
  "list_inventory_items",
  "list_notifications",
]

export type ToolSlice = {
  /** Tool names to expose on this turn. */
  names: string[]
  /** Domains the ask matched (excludes the always-on core). */
  domains: PartnerToolDomain[]
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

/** Domains whose trigger words appear in the given text. */
export function matchDomains(text: string): PartnerToolDomain[] {
  const haystack = text.toLowerCase()
  const hits: PartnerToolDomain[] = []
  for (const [domain, keywords] of Object.entries(DOMAIN_KEYWORDS)) {
    const hit = keywords.some((kw) =>
      new RegExp(`\\b${escapeRe(kw)}\\b`).test(haystack)
    )
    if (hit) hits.push(domain as PartnerToolDomain)
  }
  return hits
}

/**
 * Pick the tools to expose for one ask.
 *
 * `tools` should already be filtered by the write gate — this only narrows
 * further, it never re-admits a tool the surface disabled.
 */
export function selectPartnerToolSlice(
  text: string,
  tools: McpToolDef[]
): ToolSlice {
  const available = new Set(tools.map((t) => t.name))
  const domains = matchDomains(text)
  const wanted = new Set<PartnerToolDomain>([...domains, "core"])

  const names = new Set<string>()
  for (const name of ALWAYS_ON_TOOLS) {
    if (available.has(name)) names.add(name)
  }
  for (const def of tools) {
    const domain = toolDomain(def)
    if (domain && wanted.has(domain)) names.add(def.name)
  }

  return { names: [...names], domains }
}

/** Every tool in a domain (used to widen the slice on request). */
export function toolsInDomains(
  domains: string[],
  tools: McpToolDef[]
): string[] {
  const wanted = new Set(domains)
  return tools.filter((t) => wanted.has(toolDomain(t) ?? "")).map((t) => t.name)
}

/** The escape-hatch tool the model calls to widen its own slice. */
export const LOAD_TOOLS_TOOL_NAME = "load_partner_tools"

/**
 * Domains the model already widened into earlier in THIS conversation.
 *
 * The slice is recomputed per HTTP request from keywords, and the chat route
 * strips tool parts from history — so without this a domain bought with a
 * round trip on turn N is silently gone on turn N+1, and the model has no
 * transcript evidence it ever had it. A follow-up like "now do the same for the
 * other one" would re-pay the widening AND burn one of the step budget.
 *
 * Reads the RAW inbound messages (before the route's text-only normalisation),
 * and only ever returns known selectable domains, so a malformed or
 * adversarial history part can widen nothing it could not widen by asking.
 *
 * The parse is shared with the admin surface via lib/mcp-core; only the domain
 * union and the load-tool name differ.
 */
export function widenedDomainsFromHistory(
  rawMessages: unknown
): PartnerToolDomain[] {
  return sharedWidenedDomainsFromHistory(rawMessages, {
    loadToolName: LOAD_TOOLS_TOOL_NAME,
    selectable: SELECTABLE_DOMAINS,
  })
}

/** The domains a partner can ask to be widened into. */
export const SELECTABLE_DOMAINS: PartnerToolDomain[] = [
  "orders",
  "catalog",
  "storefront",
  "designs",
  "production",
  "inventory",
  "customers",
  "money",
]
