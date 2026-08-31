/**
 * GET /admin/mcp/graph-entities — the query.graph entity names available for
 * stats panels (metric_sections / aggregate_data / time_series).
 *
 * The admin assistant hallucinated entity names ("orders", "subscriptions",
 * "payments") because `metric_sections.entity` is a free string with no
 * source of truth. This route is that source: a curated list of the REAL
 * query.graph entity names, verified against prod (plural snake_case — the
 * singular form of a few models does NOT resolve, so plural is canonical).
 *
 * Keep in sync with the DML `model.define(...)` names; the broader catalog is
 * at GET /admin/visual-flows/metadata (which pluralizes + also misses the
 * order-transaction and partner-plan sub-models below).
 */
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

export type GraphEntity = {
  name: string
  type: "core" | "custom"
  description: string
  /** Key fields, for the entities a stats panel most commonly aggregates. */
  fields?: string[]
}

const GRAPH_ENTITIES: GraphEntity[] = [
  // ── Order / money (the "stats" entities) ──────────────────────────
  {
    name: "orders",
    type: "core",
    description:
      "Customer orders. NOTE: money fields (total/subtotal/item_total) are NOT fetchable via query.graph — use order_transactions for captured amounts.",
    fields: ["id", "status", "currency_code", "created_at"],
  },
  {
    name: "order_transactions",
    type: "core",
    description:
      "Payment transactions on orders. reference='capture' means paid. The only per-order money signal query.graph can fetch.",
    fields: ["order_id", "amount", "currency_code", "reference", "created_at"],
  },
  {
    name: "order_items",
    type: "core",
    description: "Line items on an order.",
    fields: ["order_id", "title", "quantity", "unit_price"],
  },

  // ── Commission / billing ──────────────────────────────────────────
  {
    name: "partner_fees",
    type: "custom",
    description:
      "Platform commission accrued per partner order. status ∈ accrued | invoiced | waived | reversed.",
    fields: ["partner_id", "order_id", "fee_amount", "fee_type", "currency_code", "status", "accrued_at"],
  },

  // ── Subscriptions ─────────────────────────────────────────────────
  {
    name: "partner_subscriptions",
    type: "custom",
    description:
      "Partner plan subscriptions. status ∈ active | canceled | expired | past_due. Nest plan.* for price/interval.",
    fields: ["partner_id", "status", "plan.price", "plan.interval", "plan.currency_code"],
  },
  {
    name: "partner_plans",
    type: "custom",
    description: "Partner subscription plan tiers. interval ∈ monthly | yearly.",
    fields: ["name", "price", "interval", "currency_code", "is_active"],
  },

  // ── Catalog / customers / partners ────────────────────────────────
  { name: "products", type: "core", description: "Products (catalog).", fields: ["id", "title", "status"] },
  { name: "product_variants", type: "core", description: "Product variants." },
  { name: "customers", type: "core", description: "Customer accounts." },
  { name: "partners", type: "custom", description: "Partner (artisan/brand) records." },
  { name: "partner_onboarding_profiles", type: "custom", description: "Partner onboarding profiles." },
  { name: "partner_payment_configs", type: "custom", description: "Partner payment configs." },
  { name: "designs", type: "custom", description: "Product designs." },

  // ── Operations ────────────────────────────────────────────────────
  { name: "production_runs", type: "custom", description: "Production runs." },
  { name: "inventory_orders", type: "custom", description: "Inventory orders." },
  { name: "inventory_items", type: "custom", description: "Inventory items." },
  { name: "raw_materials", type: "custom", description: "Raw materials." },
  { name: "tasks", type: "custom", description: "Tasks." },
  { name: "people", type: "custom", description: "People / weaver directory (person module)." },
  { name: "person_types", type: "custom", description: "Person types." },
  { name: "notes", type: "custom", description: "Notes." },
  { name: "unified_order_statuses", type: "custom", description: "Unified partner-facing order statuses." },

  // ── Marketing / analytics / finance ───────────────────────────────
  { name: "websites", type: "custom", description: "Marketing websites." },
  { name: "marketing_metric_snapshots", type: "custom", description: "Daily marketing metrics.", fields: ["metric_key", "value", "captured_for_date"] },
  { name: "analytics_daily_stats", type: "custom", description: "Daily analytics rollups.", fields: ["date", "unique_visitors"] },
  { name: "company_expenses", type: "custom", description: "Company expenses.", fields: ["amount", "category", "recurrence", "status"] },
  { name: "social_posts", type: "custom", description: "Social posts." },

  // ── Core platform (less common for stats) ─────────────────────────
  { name: "regions", type: "core", description: "Regions / markets." },
  { name: "currencies", type: "core", description: "Currencies." },
  { name: "stores", type: "core", description: "Stores." },
  { name: "sales_channels", type: "core", description: "Sales channels." },
  { name: "stock_locations", type: "core", description: "Stock locations." },
  { name: "fulfillments", type: "core", description: "Fulfillments." },
  { name: "payments", type: "core", description: "Payment records." },
  { name: "payment_collections", type: "core", description: "Payment collections." },
  { name: "promotions", type: "core", description: "Promotions / discounts." },
  { name: "tax_rates", type: "core", description: "Tax rates." },
  { name: "users", type: "core", description: "Admin users." },
  { name: "api_keys", type: "core", description: "API keys." },
  { name: "carts", type: "core", description: "Shopping carts." },
]

export const GET = async (_req: MedusaRequest, res: MedusaResponse) => {
  res.json({ entities: GRAPH_ENTITIES })
}