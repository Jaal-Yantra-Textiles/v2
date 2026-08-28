/**
 * Context extraction from a completed assistant turn.
 *
 * After `streamText` finishes, the `onFinish` callback has the tool calls and
 * their results. This module walks those results, extracts entity ids and
 * builds a compact per-domain summary, and returns one entry per domain
 * touched — ready to upsert into the context cache.
 *
 * The extraction is deliberately heuristic and defensive:
 * - Entity ids are found by recursively scanning for string values matching
 *   known platform prefixes (order_, prod_, design_, etc.).
 * - Summaries are built from common result shapes (lists with counts, single
 *   entities with titles, status fields).
 * - Anything it can't parse is silently skipped — a missing cache entry is
 *   harmless, a crash in onFinish is not.
 */
import { toolNameToDomain, type AssistantSurface } from "./domains"
import { extractEntityResolutions, type EntityResolution } from "./entities"

export interface ExtractedContextEntry {
  domain: string
  entityIds: string[]
  summary: string
  resolutions: EntityResolution[]
}

/** Known entity-id prefixes on the JYT platform. */
const ENTITY_PREFIXES = [
  "order_", "prod_", "variant_", "cus_", "partner_", "design_", "task_",
  "store_", "prun_", "ful_", "iitem_", "rawmat_", "rmg_", "spost_",
  "pay_", "campaign_", "collection_", "pcat_", "ptag_", "ptype_",
]

/** True if a string looks like a platform entity id. */
function isEntityId(v: string): boolean {
  return ENTITY_PREFIXES.some((p) => v.startsWith(p) && v.length > p.length + 2)
}

/** Recursively extract all entity-id-like strings from a JSON value. */
export function extractEntityIds(obj: unknown): string[] {
  const ids = new Set<string>()

  const walk = (v: unknown) => {
    if (typeof v === "string") {
      if (isEntityId(v)) ids.add(v)
    } else if (Array.isArray(v)) {
      for (const item of v) walk(item)
    } else if (v && typeof v === "object") {
      const o = v as Record<string, unknown>
      if (typeof o.id === "string" && isEntityId(o.id)) {
        ids.add(o.id)
      }
      for (const val of Object.values(o)) walk(val)
    }
  }

  walk(obj)
  return [...ids]
}

/** Common array-key names that hold list results. */
const LIST_KEYS = [
  "orders", "products", "customers", "partners", "designs",
  "production_runs", "runs", "items", "variants", "stores",
  "conversations", "payments", "campaigns", "notifications",
  "inventory_items", "raw_materials", "raw_material_groups",
  "tasks", "social_posts", "results",
]

/** Read one property off an unknown value without asserting its shape. */
const prop = (v: unknown, key: string): unknown =>
  v && typeof v === "object" ? (v as Record<string, unknown>)[key] : undefined

/** Build a one-line summary from a tool result. */
function buildToolSummary(toolName: string, output: unknown): string {
  // The dispatcher wraps results as { data } for some tools and returns them
  // bare for others, so unwrap defensively — `output` is genuinely unknown
  // here and reaching into it directly is what failed the prod build.
  const data = prop(output, "data") ?? output

  if (data && typeof data === "object") {
    // List shape: { orders: [...] } or { items: [...] }
    for (const key of LIST_KEYS) {
      const arr = (data as Record<string, unknown>)[key]
      if (Array.isArray(arr) && arr.length > 0) {
        const count = arr.length
        const first = arr[0] as Record<string, unknown>
        const label =
          first?.title ?? first?.name ?? first?.email ?? first?.id ?? ""
        return `${toolName}: ${count} ${key}${label ? `, first: ${label}` : ""}`
      }
    }

    // Single-entity shape: { id: "...", title: "..." }
    if (typeof (data as Record<string, unknown>).id === "string") {
      const d = data as Record<string, unknown>
      const label =
        d.title ?? d.name ?? d.email ?? d.handle ?? ""
      const status = d.status ? `, ${d.status}` : ""
      return `${toolName}: ${d.id}${label ? ` (${label})` : ""}${status}`
    }

    // Count shape: { count: N }
    if (typeof (data as Record<string, unknown>).count === "number") {
      return `${toolName}: ${(data as Record<string, unknown>).count} items`
    }
  }

  return `${toolName}: called`
}

/** Maximum entity ids to keep per domain entry — thin by design. */
const MAX_ENTITY_IDS = 20

/** Maximum natural-key resolutions to keep per domain entry. */
const MAX_RESOLUTIONS = 50

/** Maximum summary length per domain entry. */
const MAX_SUMMARY_LEN = 200

/**
 * Extract per-domain context entries from a completed assistant turn.
 *
 * `toolResults` is the array from the AI SDK's `onFinish` callback — each item
 * has a `toolName` and an `output`. The extraction is defensive: any shape it
 * can't recognise is skipped, and it never throws.
 */
export function extractContextFromTurn(
  toolResults: Array<{ toolName?: string; output?: unknown }> | undefined,
  surface?: AssistantSurface
): ExtractedContextEntry[] {
  if (!toolResults?.length) return []

  const byDomain = new Map<
    string,
    {
      entityIds: Set<string>
      summaries: string[]
      resolutions: Map<string, EntityResolution>
    }
  >()

  for (const tr of toolResults) {
    const toolName = tr?.toolName
    if (!toolName) continue

    // Surface-aware: a domain this surface's slicer cannot select would be
    // written and then never read.
    const domain = toolNameToDomain(toolName, surface)
    if (!domain) continue

    const output = tr.output
    const ids = extractEntityIds(output)
    const summary = buildToolSummary(toolName, output)
    const resolutions = extractEntityResolutions(output)

    let entry = byDomain.get(domain)
    if (!entry) {
      entry = { entityIds: new Set(), summaries: [], resolutions: new Map() }
      byDomain.set(domain, entry)
    }

    for (const id of ids) entry.entityIds.add(id)
    entry.summaries.push(summary)
    for (const r of resolutions) {
      entry.resolutions.set(`${r.type}:${r.key}:${r.value}`, r)
    }
  }

  const entries: ExtractedContextEntry[] = []
  for (const [domain, { entityIds, summaries, resolutions }] of byDomain) {
    const allIds = [...entityIds].slice(0, MAX_ENTITY_IDS)
    const combined = summaries.join("; ").slice(0, MAX_SUMMARY_LEN)
    const allResolutions = [...resolutions.values()].slice(0, MAX_RESOLUTIONS)
    entries.push({
      domain,
      entityIds: allIds,
      summary: combined,
      resolutions: allResolutions,
    })
  }

  return entries
}
