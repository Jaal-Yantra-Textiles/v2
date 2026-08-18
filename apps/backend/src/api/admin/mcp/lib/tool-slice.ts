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
// Imported from the submodule, not the barrel: this module is otherwise a
// type-only consumer of mcp-core, and pulling the barrel in for one function
// would drag dispatch/proxy/server into every context that slices a registry.
import { widenedDomainsFromHistory as sharedWidenedDomainsFromHistory } from "../../../../lib/mcp-core/tool-slice"

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
  // Data Plumbing / maintenance jobs are audited operational corrections, so
  // they ride the observability slice alongside the usage ledger.
  ["/admin/ops", "observability"],
  ["/admin/orders", "orders"],
  ["/admin/order-edits", "orders"],
  ["/admin/products", "catalog"],
  ["/admin/stores", "catalog"],
  // Customs/HS-code tooling operates on the catalogue, so it belongs to the
  // catalog slice. Without this entry the tools classify as undefined and never
  // light up for a customs question.
  ["/admin/customs", "catalog"],
  ["/admin/customers", "customers"],
  ["/admin/partners", "partners"],
  ["/admin/designs", "designs"],
  ["/admin/design-work-orders", "designs"],
  ["/admin/production-run-policy", "production"],
  ["/admin/production-runs", "production"],
  // Task templates ARE the dispatch vocabulary — every run tool that takes
  // template_names needs a name from here, and an invented one fails the
  // dispatch outright. Without this entry the tool classifies as undefined and
  // loads in NO slice, so the model would keep guessing names it cannot see.
  ["/admin/task-templates", "production"],
  ["/admin/inventory-items", "inventory"],
  ["/admin/inventory-orders", "inventory"],
  ["/admin/raw-material-groups", "inventory"],
  // Photo -> raw materials + inventory. Classified as inventory because that is
  // what it CREATES; the image is just the input format.
  ["/admin/ai/image-extraction", "inventory"],
  // Reference-image search feeds design creation, so it lights up with designs.
  ["/admin/pinterest", "designs"],
  // Reading an attached image is domain-agnostic — it must be reachable from
  // any conversation, so it lives in the always-present core slice.
  ["/admin/assistant/vision", "core"],
  ["/admin/payments", "money"],
  ["/admin/publishing-campaigns", "marketing"],
  ["/admin/notifications", "marketing"],
  // Social posts and platform integrations belong to marketing — they are the
  // organic publishing surface alongside the automated campaigns.
  ["/admin/social-posts", "marketing"],
  ["/admin/social-platforms", "marketing"],
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
    // Customs vocabulary — a "the HSN is missing" ask must reach the catalog
    // slice, since that's where the codes are written. The PREFIX_DOMAINS entry
    // above only classifies the tools; these are what ACTIVATE the slice.
    "hsn", "hs code", "hs codes", "hs_code", "customs", "harmonized",
    "harmonised", "tariff", "duty", "commodity code",
    // Bulk catalogue vocabulary. `bulk_update_products` classifies as catalog
    // (it lives under /admin/products) but the asks that need it are usually
    // phrased in inventory words — "set stock to zero for everything", "start
    // tracking stock on the whole range". Without these the ask matches only
    // the inventory slice and the one tool that can do it never loads.
    "bulk", "in bulk", "all products", "every product", "whole catalogue",
    "whole catalog", "manage inventory", "manage_inventory", "track stock",
    "tracking stock", "zero",
    // Production-spec vocabulary (#1346). The spec tools classify as catalog by
    // route, but a maker's ask for them is phrased in loom words — "record the
    // weave and palette for this shawl" says neither "product" nor "catalog".
    // Classification without an activating phrase is a tool nobody can reach.
    "spec", "specs", "specification", "production spec", "weave", "weaves",
    "woven", "weaving", "warp", "weft", "loom", "gsm", "thread count",
    "ends per inch", "picks per inch", "palette", "colour palette",
    "color palette", "colours", "colors", "finish", "finishes",
    "custom order", "custom orders", "made to order",
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
    // The brief — attributes that describe the idea rather than the garment.
    "brief", "concept", "aesthetic", "persona", "price point", "inspiration",
    "reference", "pinterest", "mood board", "idea",
    // Construction details. The technique nouns matter: an operator says
    // "add a waist dart", never "add a construction detail".
    "construction", "dart", "darts", "pleat", "pleats", "gather", "gathers",
    "tuck", "tucks", "topstitch", "topstitching", "seam", "seams", "yoke",
    "yokes", "embroidery", "silhouette", "garment",
  ],
  production: [
    "production", "production run", "production runs", "run", "runs",
    "dispatch", "dispatched", "approve", "approval", "stage", "task", "tasks",
    "template", "templates", "manufacture", "manufacturing", "factory",
    "capacity", "wip", "in progress",
    // The vocabulary of a lapsed run. "Send this partner's parked runs back to
    // them" has to reach the production slice — without these it reads as a
    // purely partner-domain question and the run tools never load.
    "reassign", "reassignment", "re-assign", "re-assignment", "reassigned",
    "parked", "lapsed", "declined", "redispatch", "re-dispatch",
  ],
  inventory: [
    "inventory", "stock", "stocks", "raw material", "raw materials",
    "material", "materials", "fabric", "yarn", "warehouse", "location",
    "restock", "reorder", "purchase order",
    // Material groups + the vocabulary of a physical delivery, which is what an
    // operator photographs and asks us to file.
    "material group", "material groups", "swatch", "swatches", "trim", "trims",
    "bolt", "bolts", "roll", "rolls", "composition", "gsm", "yardage",
    "meterage", "delivery note", "packing list", "unit cost", "moq",
  ],
  money: [
    "payment", "payments", "payout", "payouts", "invoice", "invoices",
    "revenue", "settle", "settlement", "money", "paid", "unpaid", "balance",
  ],
  marketing: [
    "campaign", "campaigns", "newsletter", "email", "emails", "notification",
    "notifications", "marketing", "publish campaign", "blog", "subscriber",
    "subscribers",
    // Social post vocabulary — the organic publishing surface. Without these
    // a "post to Instagram" or "create a Facebook post" ask never lights the
    // marketing slice, so the social tools never load.
    "social", "social post", "social posts", "social media", "instagram",
    "facebook", "twitter", "tweet", "linkedin", "post to", "publish post",
    "reel", "caption", "hashtag", "hashtags", "fbinsta",
  ],
  observability: [
    "mcp", "tool usage", "telemetry", "observability", "ledger", "audit",
    "failing", "failures", "error rate",
    // Data Plumbing vocabulary. An operator describing a data problem rarely
    // says "maintenance job" — they say "the stock is wrong" or "reversed", so
    // the repair words matter more than the product name.
    "maintenance job", "maintenance jobs", "data plumbing", "backfill",
    "backfills", "repair", "reconcile", "reconciliation", "dry run", "dry-run",
    "reversed", "mis-assigned", "wrong location", "wrong warehouse",
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

/** The escape-hatch tool the model calls to widen its own slice. */
export const LOAD_TOOLS_TOOL_NAME = "load_admin_tools"

/**
 * Domains the model already widened into earlier in THIS conversation.
 *
 * The slice is recomputed per HTTP request from keywords, and the chat route
 * strips tool parts from history — so without this a domain bought with a
 * `load_admin_tools` round trip on turn N is silently gone on turn N+1, and the
 * model has no transcript evidence it ever had it. A follow-up like "now do the
 * same for the other one" re-pays the widening AND burns one of the 8 steps.
 *
 * Reads the RAW inbound messages (before the route's text-only normalisation),
 * and only ever returns known selectable domains, so a malformed or
 * adversarial history part can widen nothing it could not widen by asking.
 *
 * Mirrored for the partner surface in partners/mcp/lib/tool-slice — the two
 * slicers are deliberately parallel modules over different domain unions, but
 * the history parse itself is one implementation in lib/mcp-core.
 */
export function widenedDomainsFromHistory(
  rawMessages: unknown
): AdminToolDomain[] {
  return sharedWidenedDomainsFromHistory(rawMessages, {
    loadToolName: LOAD_TOOLS_TOOL_NAME,
    selectable: SELECTABLE_DOMAINS,
  })
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
