/**
 * Structured plan execution over the MCP tool registry.
 *
 * `dispatchMcpTool` runs ONE tool against ONE route. A request that needs
 * several tools ("orders for customer X") forces the model to chain raw
 * function calls itself — resolve the reference, remember the id, pass it to
 * the next tool. That is where single tool calls fail: the model invents a
 * filter syntax or passes a name where an id belongs, and the result is either
 * a 4xx or, worse, `ok:true` with zero rows.
 *
 * A plan is the structured alternative. The model emits steps; this executor
 * runs them with three mechanisms the raw path lacks:
 *   - reference substitution: `extract` pulls one value out of a result and
 *     stores it; later args reference it as `$name` (or `$name.path`).
 *   - fan-out: a `map` step iterates a stored list and runs sub-steps per item.
 *   - deterministic retry: a list step that comes back empty is re-dispatched
 *     once with a broadened filter.
 *
 * Every step still goes through `dispatchMcpTool`, so the dry_run / confirm /
 * reason rails and scope checks apply per step — the plan cannot smuggle past
 * a guard that a single call could not.
 *
 * Plan grammar (see McpPlanStep):
 *   {"tool": name, "args": {...}, "as": name|null, "extract": "path"|null}
 *   {"map": "listName", "item": "var", "steps": [ ... ]}
 *
 * Scoping guidance for the model (singular vs plural): prefer `extract` when
 * the request names ONE thing ("the first run of the design"); reserve `map`
 * for plural asks ("each", "per", "every"). This is a prompt-level rule — the
 * executor runs either shape, but the singular form is far cheaper.
 */
import type { McpContext, McpToolDef, McpToolResult } from "./types"
import { dispatchMcpTool } from "./dispatch"

export type McpPlanStep = {
  tool?: string
  args?: Record<string, unknown>
  /** Store the step's full result data under this name (for lists you will map). */
  as?: string
  /** Pull one value out of the result (dot/bracket path into "data"); stored under `as` or `$N`. */
  extract?: string | null
  /** Iterate a stored list (by its `as` name). */
  map?: string
  /** Loop variable; inside sub-steps reference it as `$var.field`. */
  item?: string
  steps?: McpPlanStep[]
  /** Memory lookup: resolve an entity of this type by a natural key. */
  resolve?: string
  /** Natural key field to resolve by, e.g. "email". Defaults to "id". */
  by?: string
  /** The key's value to resolve, e.g. "delhi@gmail.com". */
  value?: string
  /** Run this tool only when the memory lookup misses, extracting into `as`. */
  fallback?: McpPlanFallback
}

export type McpPlanFallback = {
  tool: string
  args?: Record<string, unknown>
  extract?: string | null
}

/** Memory resolver: returns an entity id for (type, key, value), or null. */
export type EntityResolver = (
  type: string,
  by: string,
  value: string
) => Promise<string | null> | string | null

export type McpPlan = { steps: McpPlanStep[] }

export type McpPlanMapResult = { map: string; count: number; results: unknown[] }

export type ExecutePlanOptions = {
  ctx: McpContext
  tools: McpToolDef[]
  plan: McpPlan
  /** When false, the empty-result retry is disabled. Defaults true. */
  retry?: boolean
  /** Test seam: override the per-tool dispatch. */
  dispatch?: (name: string, args: Record<string, unknown>) => Promise<McpToolResult>
  /** Memory resolver consulted by `resolve` steps. */
  resolveEntity?: EntityResolver
}

export type McpPlanResult = {
  ok: boolean
  value: McpToolResult | McpPlanMapResult | null
  toolCalls: number
  retries: number
  error?: string
}

/** Navigate a dot/bracket path ("designs.0.id") into an unknown value. */
export function navPlanPath(data: unknown, path: string): unknown {
  if (!path) return data
  let cur: any = data
  for (let p of path.split(".")) {
    if (cur == null) return undefined
    const m = p.match(/^(\w+)\[(\d+)\]$/)
    if (m) cur = cur[m[1]]?.[Number(m[2])]
    else cur = cur[p]
  }
  return cur
}

function resolveRef(v: unknown, store: Record<string, unknown>): unknown {
  if (typeof v !== "string") return v
  const m = v.match(/^\$([A-Za-z_]\w*)(?:\.(.+))?$/)
  if (!m) return v
  const base = store[m[1]]
  return m[2] ? navPlanPath(base, m[2]) : base
}

function resolveArgs(
  args: Record<string, unknown> | undefined,
  store: Record<string, unknown>
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(args ?? {})) out[k] = resolveRef(v, store)
  return out
}

/** True when a list result came back with nothing (count 0 or empty array). */
export function isEmptyPlanResult(data: unknown): boolean {
  if (!data || typeof data !== "object" || Array.isArray(data)) return false
  const o = data as Record<string, unknown>
  if (o.count === 0) return true
  return Object.values(o).some((v) => Array.isArray(v) && v.length === 0)
}

/**
 * Widen a free-text filter so a miss can be retried.
 *
 * Only `q` is broadenable. An exact natural-key filter (email/name/id/handle)
 * that returns empty is a CORRECT miss — "no customer with this email" — not a
 * too-narrow search; broadening it would drop the key and return the whole
 * table, silently answering a different question. When there is nothing to
 * broaden the args come back unchanged and the caller skips the retry.
 */
export function broadenPlanArgs(args: Record<string, unknown>): Record<string, unknown> {
  const next = { ...args }
  if (typeof next.q === "string") {
    const q = next.q as string
    if (q.includes(" ")) next.q = q.split(" ")[0]
    else delete next.q
  }
  return next
}

export async function executeMcpPlan(opts: ExecutePlanOptions): Promise<McpPlanResult> {
  const dispatch =
    opts.dispatch ??
    ((name: string, args: Record<string, unknown>) => dispatchMcpTool(opts.ctx, opts.tools, name, args))

  const store: Record<string, unknown> = {}
  let toolCalls = 0
  let retries = 0
  let error: string | undefined

  const run = async (
    steps: McpPlanStep[],
    store: Record<string, unknown>
  ): Promise<McpToolResult | McpPlanMapResult | null> => {
    let last: McpToolResult | McpPlanMapResult | null = null

    for (let i = 0; i < steps.length; i++) {
      const s = steps[i]

      if (s.map && s.steps) {
        const listName = (s.map as string).replace(/^\$/, "")
        let list = store[listName]
        if (!Array.isArray(list) && list && typeof list === "object") {
          const arr = Object.values(list).find(Array.isArray)
          if (arr) list = arr
        }
        const results: unknown[] = []
        for (const el of Array.isArray(list) ? list : []) {
          results.push(await run(s.steps, { ...store, [s.item as string]: el }))
        }
        last = { map: s.map, count: results.length, results }
        continue
      }

      // ── Memory resolve ─────────────────────────────────────────────────
      // A `resolve` step consults memory first; it only dispatches a tool when
      // the resolver misses and a fallback tool is given.
      if (s.resolve) {
        const id = opts.resolveEntity
          ? await opts.resolveEntity(s.resolve, s.by ?? "id", String(s.value ?? ""))
          : null
        if (id) {
          store[s.as ?? String(i + 1)] = id
          last = { ok: true, tool: `resolve:${s.resolve}`, data: { id } } as McpToolResult
          continue
        }
        if (!s.fallback) {
          error = `No cached ${s.resolve} for ${s.by ?? "id"}=${s.value}`
          break
        }
        // Miss: fall through and run the fallback tool with the step's `as`/extract.
        var step = {
          tool: s.fallback.tool,
          args: s.fallback.args,
          as: s.as,
          extract: s.fallback.extract,
        } as McpPlanStep
      } else {
        var step = s
      }

      const args = resolveArgs(step.args, store)
      let res = await dispatch(step.tool as string, args)
      toolCalls++
      last = res

      if (opts.retry !== false && res?.ok && isEmptyPlanResult(res.data)) {
        const broad = broadenPlanArgs(args)
        if (JSON.stringify(broad) !== JSON.stringify(args)) {
          retries++
          res = await dispatch(step.tool as string, broad)
          toolCalls++
          last = res
        }
      }

      if (!res?.ok) {
        error = res?.error
        break
      }

      if (step.extract) {
        store[step.as ?? String(i + 1)] = navPlanPath(res.data, step.extract)
      } else if (step.as) {
        store[step.as] = res.data
      }
    }

    return last
  }

  const value = await run(opts.plan.steps, store)
  const ok = !error
  return { ok, value, toolCalls, retries, ...(error ? { error } : {}) }
}

/** Prompt guidance so the model scopes a plan correctly (singular vs plural). */
export const PLAN_SCOPE_GUIDANCE =
  'When the request names ONE entity ("the first X", "the design", "a single"), ' +
  'use "extract" and a linear chain. Use "map" only for plural asks ("each", "per", "every").'