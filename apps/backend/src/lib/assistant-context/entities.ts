/**
 * Entity-resolution extraction for assistant memory.
 *
 * The existing `extractEntityIds` keeps a flat list of id-like strings so the
 * next turn can say "you already looked at these". What it cannot do is answer
 * "what is the id of customer delhi@gmail.com?" — the natural key that lets a
 * PLANNER skip a lookup step entirely.
 *
 * This module extracts that richer fact: for each entity id found in a tool
 * result, record its type (from the id prefix), a natural key (email/name/handle),
 * and the key's value. The result feeds `buildEntityResolver`, which is the
 * memory the plan executor's `resolve` step consults before re-calling a tool.
 *
 * Pure and dependency-free on purpose — it runs after every turn and is unit
 * tested without a database.
 */

export interface EntityResolution {
  /** Entity type: "customer", "order", "design", ... */
  type: string
  /** Natural key field: "email", "name", "handle", ... */
  key: string
  /** The key's value, e.g. "delhi@gmail.com". */
  value: string
  /** The resolved entity id, e.g. "cus_01KS9B...". */
  id: string
  /** Optional display label (name/title) for diagnostics. */
  label?: string
}

/**
 * Id prefix -> entity type. Longest-prefix-first on purpose: `prod_run_` must
 * classify before `prod_`, or every production-run id is read as a product.
 */
const PREFIX_TO_TYPE: ReadonlyArray<readonly [string, string]> = [
  ["prod_run_", "production_run"],
  ["prod_", "product"],
  ["variant_", "variant"],
  ["partner_", "partner"],
  ["design_", "design"],
  ["order_", "order"],
  ["customer_", "customer"],
  ["cus_", "customer"],
  ["store_", "store"],
  ["task_", "task"],
  ["ful_", "fulfillment"],
  ["iitem_", "inventory_item"],
  ["rawmat_", "raw_material"],
  ["rmg_", "raw_material_group"],
  ["pay_", "payment"],
  ["campaign_", "campaign"],
  ["collection_", "collection"],
  ["pcat_", "product_category"],
  ["ptag_", "product_tag"],
  ["ptype_", "product_type"],
  ["spost_", "social_post"],
]

/** Entity type -> natural key fields, in priority order (first present wins). */
const TYPE_KEY_FIELDS: Record<string, string[]> = {
  customer: ["email", "phone", "name"],
  partner: ["email", "name"],
  design: ["name", "handle"],
  product: ["handle", "title"],
  variant: ["title", "sku"],
  order: ["email", "display_id"],
  store: ["name", "handle"],
  task: ["title", "name"],
  fulfillment: ["display_id"],
  inventory_item: ["title", "sku"],
  raw_material: ["title", "name"],
  raw_material_group: ["title", "name"],
  payment: ["display_id"],
  campaign: ["title", "name"],
  collection: ["title", "handle"],
  product_category: ["name", "handle"],
  product_tag: ["value"],
  product_type: ["value"],
  social_post: ["title"],
}

/** Infer an entity type from an id prefix, or undefined when unknown. */
export function inferEntityType(id: string): string | undefined {
  for (const [prefix, type] of PREFIX_TO_TYPE) {
    if (id.startsWith(prefix) && id.length > prefix.length + 2) return type
  }
  return undefined
}

/** One-line label from an object, if it has one. Never the key itself (email). */
function labelOf(o: Record<string, unknown>): string | undefined {
  const v = o.title ?? o.name ?? o.handle ?? o.first_name ?? o.last_name
  return typeof v === "string" && v ? v : undefined
}

/**
 * Walk a tool result and extract entity resolutions: for every object carrying
 * a platform entity id, record its type, a natural key and that key's value.
 */
export function extractEntityResolutions(output: unknown): EntityResolution[] {
  const out: EntityResolution[] = []
  const seen = new Set<string>()

  const walk = (v: unknown): void => {
    if (Array.isArray(v)) {
      for (const item of v) walk(item)
      return
    }
    if (!v || typeof v !== "object") return
    const o = v as Record<string, unknown>

    if (typeof o.id === "string") {
      const type = inferEntityType(o.id)
      if (type) {
        for (const field of TYPE_KEY_FIELDS[type] ?? []) {
          const value = o[field]
          if (typeof value === "string" && value.trim()) {
            const k = `${type}:${field}:${value}`
            if (!seen.has(k)) {
              seen.add(k)
              out.push({ type, key: field, value, id: o.id, label: labelOf(o) })
            }
            break
          }
        }
      }
    }

    for (const val of Object.values(o)) walk(val)
  }

  walk(output)
  return out
}

/** Type of the resolver the plan executor consumes. */
export type EntityResolver = (type: string, by: string, value: string) => string | null

/**
 * Build an in-memory entity resolver from extracted resolutions. This is both
 * the shape the plan executor's `resolve` step consumes and a test seam for the
 * cache-backed resolver that will stand behind it.
 */
export function buildEntityResolver(resolutions: EntityResolution[]): EntityResolver {
  const map = new Map<string, string>()
  for (const r of resolutions) map.set(`${r.type}:${r.key}:${r.value}`, r.id)
  return (type, by, value) => map.get(`${type}:${by}:${value}`) ?? null
}