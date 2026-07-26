/**
 * Per-ask registry slicing for the admin assistant.
 *
 * The registry is ~100 tools. The MCP JSON-RPC endpoint can afford to advertise
 * all of them (external clients enumerate once and manage their own context),
 * but the in-app assistant re-sends every bound tool definition on EVERY turn —
 * so registry size becomes a per-request token cost, and the free-model rotator
 * ranks by context length, which means it also influences which model answers.
 *
 * This module maps each tool to a domain and picks the domains an ask actually
 * needs. The chat route binds the full registry (so every tool stays callable)
 * but passes only the slice as `activeTools`, so only those definitions are
 * serialised to the provider.
 *
 * Nothing here can make a tool permanently unreachable: the always-on core
 * includes a discovery tool, and the chat route widens the slice mid-run when
 * the model asks for a domain it wasn't given. Getting the slice wrong costs a
 * round trip, not a capability.
 */
import type { McpToolDef } from "../../../../lib/mcp-core"

export type AdminToolDomain =
  | "core"
  | "orders"
  | "catalog"
  | "customers"
  | "partners"
  | "designs"
  | "production"
  | "inventory"
  | "money"
  | "marketing"
  | "observability"

/**
 * Route prefix -> domain. Longest prefix wins, so `/admin/production-run-policy`
 * resolves before `/admin/production-runs` would otherwise shadow it. A new
 * registry row under an existing prefix is classified automatically; a genuinely
 * new route family needs one line here (and the invariant test below fails loudly
 * until it gets one).
 */
const PREFIX_DOMAINS: ReadonlyArray<readonly [string, AdminToolDomain]> = [
  ["/admin/mcp/usage", "observability"],
  ["/admin/mcp", "core"],
  ["/admin/orders", "orders"],
  ["/admin/order-edits", "orders"],
  ["/admin/products", "catalog"],
  ["/admin/stores", "catalog"],
  ["/admin/customers", "customers"],
  ["/admin/partners", "partners"],
  ["/admin/designs", "designs"],
  ["/admin/design-work-orders", "designs"],
  ["/admin/production-run-policy", "production"],
  ["/admin/production-runs", "production"],
  ["/admin/inventory-items", "inventory"],
  ["/admin/inventory-orders", "inventory"],
  ["/admin/payments", "money"],
  ["/admin/publishing-campaigns", "marketing"],
  ["/admin/notifications", "marketing"],
]

/** Classify one tool by the route it wraps. */
export function toolDomain(def: McpToolDef): AdminToolDomain | undefined {
  const path = def.path
  if (!path) return "core" // native tools are grounding/discovery
  let best: { len: number; domain: AdminToolDomain } | undefined
  for (const [prefix, domain] of PREFIX_DOMAINS) {
    if (
      (path === prefix || path.startsWith(`${prefix}/`)) &&
      (!best || prefix.length > best.len)
    ) {
      best = { len: prefix.length, domain }
    }
  }
  return best?.domain
}

/**
 * Trigger words per domain, matched case-insensitively on word boundaries
 * against the recent conversation text. Deliberately generous — a false
 * positive costs a few hundred tokens, a false negative costs a round trip.
 */
const DOMAIN_KEYWORDS: Record<Exclude<AdminToolDomain, "core">, string[]> = {
  orders: [
    "order", "orders", "fulfil", "fulfill", "fulfilment", "fulfillment",
    "ship", "shipped", "shipping", "shipment", "deliver", "delivered",
    "delivery", "courier", "awb", "waybill", "label", "tracking", "cancel",
    "refund", "return", "line item", "line items", "checkout", "purchase",
  ],
  catalog: [
    "product", "products", "variant", "variants", "sku", "catalog",
    "catalogue", "publish", "published", "draft", "store", "stores",
    "storefront", "listing", "listings", "price", "pricing",
  ],
  customers: ["customer", "customers", "buyer", "buyers", "shopper", "shoppers"],
  partners: [
    "partner", "partners", "seller", "sellers", "manufacturer", "manufacturers",
    "maker", "makers", "artisan", "artisans", "weaver", "weavers", "vendor",
    "vendors", "onboard", "onboarding", "whatsapp", "subscription", "plan",
    "commission", "fee", "fees", "admin user", "verify", "verification",
  ],
  designs: [
    "design", "designs", "designer", "moodboard", "tech pack", "techpack",
    "size set", "size sets", "sizing", "measurement", "measurements",
    "colourway", "colorway", "revision", "revisions", "bom",
    "bill of materials", "work order", "work orders", "sample", "collection",
  ],
  production: [
    "production", "production run", "production runs", "run", "runs",
    "dispatch", "dispatched", "approve", "approval", "stage", "task", "tasks",
    "template", "templates", "manufacture", "manufacturing", "factory",
    "capacity", "wip", "in progress",
  ],
  inventory: [
    "inventory", "stock", "stocks", "raw material", "raw materials",
    "material", "materials", "fabric", "yarn", "warehouse", "location",
    "restock", "reorder", "purchase order",
  ],
  money: [
    "payment", "payments", "payout", "payouts", "invoice", "invoices",
    "revenue", "settle", "settlement", "money", "paid", "unpaid", "balance",
  ],
  marketing: [
    "campaign", "campaigns", "newsletter", "email", "emails", "notification",
    "notifications", "marketing", "publish campaign", "blog", "subscriber",
    "subscribers",
  ],
  observability: [
    "mcp", "tool usage", "telemetry", "observability", "ledger", "audit",
    "failing", "failures", "error rate",
  ],
}

/**
 * Always sent, regardless of the ask: grounding, the query planner, and the
 * cheap top-level list read for each domain. Those seven list_* tools are what
 * let an unclassifiable ask ("what's going on today?") still get somewhere, and
 * they give the model the vocabulary to widen the slice deliberately.
 */
export const ALWAYS_ON_TOOLS: readonly string[] = [
  "get_admin_stats",
  "resolve_admin_query",
  "list_orders",
  "list_products",
  "list_customers",
  "list_partners",
  "list_designs",
  "list_production_runs",
  "list_stores",
]

export type ToolSlice = {
  /** Tool names to expose on this turn. */
  names: string[]
  /** Domains the ask matched (excludes the always-on core). */
  domains: AdminToolDomain[]
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

/** Domains whose trigger words appear in the given text. */
export function matchDomains(text: string): AdminToolDomain[] {
  const haystack = text.toLowerCase()
  const hits: AdminToolDomain[] = []
  for (const [domain, keywords] of Object.entries(DOMAIN_KEYWORDS)) {
    const hit = keywords.some((kw) =>
      new RegExp(`\\b${escapeRe(kw)}\\b`).test(haystack)
    )
    if (hit) hits.push(domain as AdminToolDomain)
  }
  return hits
}

/**
 * Pick the tools to expose for one ask.
 *
 * `tools` should already be filtered by the write/dangerous env gates — this
 * only narrows further, it never re-admits a tool the surface disabled.
 */
export function selectAdminToolSlice(
  text: string,
  tools: McpToolDef[]
): ToolSlice {
  const available = new Set(tools.map((t) => t.name))
  const domains = matchDomains(text)
  const wanted = new Set<AdminToolDomain>([...domains, "core"])

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

/** The domains an operator can ask to be widened into. */
export const SELECTABLE_DOMAINS: AdminToolDomain[] = [
  "orders",
  "catalog",
  "customers",
  "partners",
  "designs",
  "production",
  "inventory",
  "money",
  "marketing",
  "observability",
]
