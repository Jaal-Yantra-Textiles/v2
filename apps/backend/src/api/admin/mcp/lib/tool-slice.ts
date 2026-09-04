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
  | "crm"
  | "observability"
  | "stats"

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
  // B2B quotes (#1439). Pre-order rather than post-purchase, but this is the
  // sales slice — a quote is what becomes the cart, and the same conversation
  // covers both.
  ["/admin/quotes", "orders"],
  ["/admin/products", "catalog"],
  ["/admin/stores", "catalog"],
  /**
   * Taxonomy. Categories and collections are how the catalogue is ORGANISED,
   * so they ride with it — an operator filing a product is having a catalogue
   * conversation, not a separate one.
   *
   * ⚠️ These two families were unclassified on `main` before #1439's quote rows
   * were added: the tools were registered without a prefix entry, which makes
   * them unreachable from any sliced ask (the slice is what the model is given,
   * so an unclassified tool may as well not exist). The same twelve rows were
   * also undeclared in `route-validator-field-coverage`'s unbound list. Both
   * gaps are the same unfinished registry addition, fixed in passing.
   */
  ["/admin/product-categories", "catalog"],
  ["/admin/collections", "catalog"],
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
  // The payout side of money. Without this entry every payable-runs /
  // payable-inventory-orders tool classifies as undefined and loads in NO
  // slice — registered, callable in principle, and reachable from no ask.
  ["/admin/payment-submissions", "money"],
  /**
   * A credit is money, not partner administration, so it rides the money slice
   * rather than inheriting `partners` from the `/admin/partners` prefix above.
   * Longer prefix wins, and this is the whole reason the match is longest-wins.
   */
  ["/admin/partners/:id/credits", "money"],
  ["/admin/publishing-campaigns", "marketing"],
  ["/admin/notifications", "marketing"],
  // Social posts and platform integrations belong to marketing — they are the
  // organic publishing surface alongside the automated campaigns.
  ["/admin/social-posts", "marketing"],
  ["/admin/social-platforms", "marketing"],
  // The sales CRM (contacts, companies, deals, follow-up tasks). Distinct from
  // `customers`, which is the Medusa storefront customer — a CRM contact is
  // somebody who has NOT bought yet. Distinct again from /admin/persons, which
  // is the weaver directory.
  ["/admin/crm", "crm"],
  // Ad-leads are the CRM's intake, so they light up with it rather than with
  // marketing: the question "who came in from the ads" is answered by working
  // the lead list, not by reading campaign spend.
  ["/admin/meta-ads/leads", "crm"],
  // Stats dashboards + panels. Their own domain: a "create a stats panel"
  // ask is about the analytics surface, not any one business domain.
  ["/admin/stats", "stats"],
  /**
   * The people directory — weavers and artisans rostered under a partner.
   *
   * 🔴 Without this entry the ID-card extraction tool classifies as `undefined`
   * and loads in NO slice: registered, callable in principle, and reachable
   * from no ask. Same trap the payout tools fell into above.
   *
   * It rides `partners` because that is the ask it belongs to — "add this
   * weaver to the partner" — not `customers`, which is the storefront buyer.
   */
  ["/admin/people", "partners"],
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
    // B2B quotes (#1439) — the ask that reaches `mint_quote` and its preflight.
    "quote", "quotes", "quoted", "quotation", "rfq", "mint a quote",
    "deposit", "moq", "bulk order", "wholesale",
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
    // People onboarding from an identity document (#1787 follow-on). "id card"
    // and "aadhaar" are what an operator actually types; without them the ask
    // "add this weaver from her aadhaar" matches only on "weaver".
    "people", "person", "id card", "identity", "aadhaar", "pan card",
    "passport", "voter id", "driving licence", "driving license",
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
    // What a partner is still OWED, and what they already hold (#1710/#1712).
    // An operator asks "what can I pay hrhandloom for?" or "does anyone hold a
    // credit?" — neither sentence contains a word above, and the ledger is the
    // one read that prevents paying for the same garments twice.
    // Bare "pay" is deliberate: "what can I still PAY this partner for?" is the
    // most natural phrasing of the question these tools exist to answer, and
    // "paid" below does not match it — word boundaries are exact.
    "pay", "pays", "paying", "owe", "owed", "owing", "outstanding", "ledger", "bill", "billed",
    "billable", "payable", "credit", "credits", "overpaid", "overpayment",
    "advance", "reconcile", "reconciliation", "settled", "unsettled",
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
  crm: [
    "crm", "lead", "leads", "contact", "contacts", "prospect", "prospects",
    // Word boundaries are exact: "contact" does NOT match "contacted", and
    // "who came in from the ads and hasn't been contacted?" is the single most
    // natural way to ask for the unworked intake queue.
    "contacted", "uncontacted", "unworked", "ad lead", "ad leads",
    "pipeline", "deal", "deals", "opportunity", "opportunities",
    "follow up", "follow-up", "followup", "outreach",
    // The pipeline stage names ARE the vocabulary: "move it to sampling" or
    // "who is at quoted" must reach the CRM slice, and neither sentence
    // contains the word "crm".
    "prospecting", "sampling", "quoted", "negotiation", "qualified",
    "unqualified", "converted",
    // What a lead physically is here. "who filled the form", "the enquiries
    // from the ads" — none of these say "lead" either.
    "enquiry", "enquiries", "inquiry", "inquiries", "form fill", "sign up",
    "signups", "buyer", "buyers", "wholesale", "stockist", "boutique",
    // The CONVERSATION axis. "did they reply?", "chase them Tuesday", "who has
    // gone quiet" are all CRM asks that name no CRM noun at all.
    "reply", "replied", "replies", "reach out", "reached out", "chase",
    "chasing", "conversation", "conversations", "timeline", "activity",
    "activities", "engagement", "engaged", "stalled", "gone quiet",
    "unresponsive", "opt out", "opted out", "opt-out", "unsubscribe",
    "do not contact", "touchpoint", "interaction", "interactions",
    // Logging a real-world touch. Bare "call" is deliberately absent — it fires
    // on "call the workflow" / "call the API"; the past tenses do not.
    "called", "phoned", "rang", "spoke to", "call with", "voicemail",
    // How an opt-out is actually reported. "taken off the list" names nothing
    // in the vocabulary, and it is the one ask where a miss is a compliance
    // problem rather than an extra round trip.
    "taken off", "take me off", "remove from list", "stop messaging",
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
  stats: [
    "stats", "stat", "statistics", "metric", "metrics", "dashboard", "dashboards",
    "panel", "panels", "kpi", "kpis", "chart", "charts", "report", "reports",
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
  "crm",
  "observability",
  "stats",
]
