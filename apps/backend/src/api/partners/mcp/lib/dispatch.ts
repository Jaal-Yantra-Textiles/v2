/**
 * Shared Partner-MCP tool dispatcher.
 *
 * One function, `dispatchPartnerTool`, runs a registry tool against the real
 * partner route via the loopback proxy. It is the single execution path for
 * BOTH consumers:
 *   - the JSON-RPC MCP endpoint (POST /partners/mcp), and
 *   - the in-app streaming assistant (POST /partners/assistant/chat), whose
 *     AI-SDK tools' `execute` delegate straight here.
 *
 * It enforces the two safety rails declared in the registry:
 *   - dry_run  → return the planned request (+ current object for writes with a
 *                previewPath) without executing.
 *   - sensitive/DELETE → require `confirm: true`; otherwise return a
 *                `requires_confirmation` plan for the UI to approve.
 */
import { PARTNER_MCP_TOOLS, type PartnerMcpToolDef } from "./registry"
import { callPartnerRoute, type PartnerProxyError } from "./proxy"

export type PartnerMcpContext = {
  /** Backend origin for loopback calls, e.g. http://localhost:9000. */
  baseUrl: string
  /** Partner JWT to forward so the wrapped route authenticates. */
  bearer?: string
  /** Session cookie to forward when the caller authed via cookie. */
  cookie?: string
  /**
   * When false, write tools (non-GET) are refused. Defaults to true for the
   * partner assistant — the partner acts on their own tenant — but a deployment
   * can force read-only via PARTNER_MCP_ENABLE_WRITE=false.
   */
  enableWrite?: boolean
}

/** Structured tool result. `ok:false` is a soft error (returned, not thrown). */
export type PartnerToolResult = {
  ok: boolean
  tool: string
  /** Successful response payload. */
  data?: unknown
  /** Soft error message. */
  error?: string
  /** Set when dry_run echoed the plan instead of executing. */
  dry_run?: boolean
  /** Set when a sensitive tool needs `confirm: true` before it will run. */
  requires_confirmation?: boolean
  /** The request that would be / was sent — { method, path, query, body }. */
  plan?: Record<string, unknown>
  /** Current object (writes with a previewPath, during dry_run/confirmation). */
  current?: unknown
  /** Human-readable warning for sensitive actions. */
  warning?: string
}

/** A tool is sensitive if flagged, or if it is a DELETE (implicitly). */
export const isSensitive = (def: PartnerMcpToolDef): boolean =>
  !!def.sensitive || def.method === "DELETE"

/**
 * Build the full JSON Schema for a tool, injecting the framework args
 * (`dry_run`, and `confirm` for sensitive tools) onto the domain schema. Used
 * by both `tools/list` and the chat route's tool binding so the model/clients
 * know these switches exist.
 */
export const buildToolInputSchema = (
  def: PartnerMcpToolDef
): Record<string, any> => {
  const base = def.inputSchema || { type: "object", properties: {} }
  const properties = { ...(base.properties || {}) }

  // Injected on EVERY tool. Lets the model state what it is trying to
  // accomplish — most valuable for multi-step goals where several tools are
  // called in sequence (e.g. creating a store, then a product, then pricing).
  // Forwarded to the route as the `x-mcp-context` header for telemetry and
  // echoed on dry_run/confirmation plans so approval cards show intent.
  properties.context = {
    type: "string",
    description:
      "One sentence on what you are ultimately trying to accomplish with this call (and the broader goal if this is one step of several). Always set it — it improves results and helps diagnose multi-step flows.",
  }

  properties.dry_run = {
    type: "boolean",
    description:
      "Preview only: return the planned request (and, for writes, the current object) WITHOUT executing. Use this to inspect data before making a change.",
  }
  if (isSensitive(def)) {
    properties.confirm = {
      type: "boolean",
      description:
        "This is a sensitive/destructive action. It will NOT run unless confirm=true. Do not set this yourself — the user must approve it.",
    }
  }

  return { ...base, properties }
}

const substitutePath = (
  template: string,
  params: string[],
  args: Record<string, unknown>
): { path?: string; missing?: string } => {
  let path = template
  for (const p of params) {
    const value = args[p]
    if (value === undefined || value === null || value === "") {
      return { missing: p }
    }
    path = path.replace(`:${p}`, encodeURIComponent(String(value)))
  }
  return { path }
}

const pick = (
  keys: string[] | undefined,
  args: Record<string, unknown>
): Record<string, unknown> => {
  const out: Record<string, unknown> = {}
  for (const k of keys ?? []) {
    if (args[k] !== undefined && args[k] !== null) {
      out[k] = args[k]
    }
  }
  return out
}

const fail = (tool: string, error: string): PartnerToolResult => ({
  ok: false,
  tool,
  error,
})

export async function dispatchPartnerTool(
  ctx: PartnerMcpContext,
  name: string,
  rawArgs: Record<string, unknown> = {}
): Promise<PartnerToolResult> {
  const def = PARTNER_MCP_TOOLS.find((t) => t.name === name)
  if (!def) {
    return fail(name, `Unknown tool: ${name}`)
  }

  const args = rawArgs || {}
  const dryRun = args.dry_run === true
  const confirmed = args.confirm === true
  const context = typeof args.context === "string" ? args.context : undefined
  const write = !!def.write
  const sensitive = isSensitive(def)

  if (write && ctx.enableWrite === false) {
    return fail(
      name,
      `Tool '${name}' is a write tool and writes are disabled on this server (PARTNER_MCP_ENABLE_WRITE=false).`
    )
  }

  // Substitute path params for the target route.
  const sub = substitutePath(def.path as string, def.pathParams ?? [], args)
  if (sub.missing) {
    return fail(name, `Missing required parameter: ${sub.missing}`)
  }
  const path = sub.path as string
  const query = pick(def.queryParams, args)
  const body = pick(def.bodyParams, args)
  const method = def.method ?? "GET"

  const plan = {
    method,
    path,
    ...(Object.keys(query).length ? { query } : {}),
    ...(Object.keys(body).length ? { body } : {}),
    ...(context ? { context } : {}),
  }

  // Fetch the current object for writes that declare a previewPath — so the
  // model (or the confirmation card) can show what is about to change.
  const fetchCurrent = async (): Promise<unknown> => {
    if (!def.previewPath) return undefined
    const psub = substitutePath(def.previewPath, def.pathParams ?? [], args)
    if (psub.missing) return undefined
    try {
      return await callPartnerRoute({
        baseUrl: ctx.baseUrl,
        method: "GET",
        path: psub.path as string,
        bearer: ctx.bearer,
        cookie: ctx.cookie,
      })
    } catch {
      return undefined
    }
  }

  // --- Dry run: never execute -------------------------------------------------
  if (dryRun) {
    const current = write ? await fetchCurrent() : undefined
    return {
      ok: true,
      tool: name,
      dry_run: true,
      plan,
      ...(current !== undefined ? { current } : {}),
      warning: sensitive
        ? "This is a sensitive action; when you run it for real it will require the user's confirmation."
        : undefined,
    }
  }

  // --- Sensitive gate: require explicit confirm -------------------------------
  if (sensitive && !confirmed) {
    const current = await fetchCurrent()
    return {
      ok: true,
      tool: name,
      requires_confirmation: true,
      plan,
      ...(current !== undefined ? { current } : {}),
      warning: `'${name}' is a sensitive action and needs explicit confirmation before it runs.`,
    }
  }

  // --- Execute for real -------------------------------------------------------
  try {
    const data = await callPartnerRoute({
      baseUrl: ctx.baseUrl,
      method,
      path,
      query,
      body,
      bearer: ctx.bearer,
      cookie: ctx.cookie,
      context,
    })
    const out = def.transform ? def.transform(data, args) : data
    return { ok: true, tool: name, data: out }
  } catch (e) {
    const err = e as PartnerProxyError
    return {
      ok: false,
      tool: name,
      error: `Error calling ${name} (${path}): ${err.message}`,
    }
  }
}
