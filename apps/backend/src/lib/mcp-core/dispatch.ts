/**
 * Shared MCP core — tool dispatcher.
 *
 * `dispatchMcpTool(ctx, tools, name, args)` runs one registry tool against its
 * real route via the loopback proxy. It is the single execution path for BOTH
 * consumers of every surface:
 *   - the JSON-RPC MCP endpoint (POST /{surface}/mcp), and
 *   - the in-app streaming assistant, whose AI-SDK tools' `execute` delegate
 *     straight here.
 *
 * It enforces three safety rails declared in the registry:
 *   - dry_run   → return the planned request (+ current object for writes with
 *                 a previewPath) without executing.
 *   - confirm   → sensitive/DELETE tools require `confirm: true`; otherwise a
 *                 `requires_confirmation` plan is returned for UI approval.
 *   - reason    → dangerous tools additionally refuse without a `reason` string
 *                 (forwarded as x-mcp-reason and audited); also require confirm.
 *
 * Each call emits one observability event through `ctx.observe` (#844).
 */
import type {
  McpContext,
  McpToolDef,
  McpToolEvent,
  McpToolResult,
} from "./types"
import { isDangerous, isSensitive } from "./schema"
import { callMcpRoute, type McpProxyError } from "./proxy"

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

export async function dispatchMcpTool(
  ctx: McpContext,
  tools: McpToolDef[],
  name: string,
  rawArgs: Record<string, unknown> = {}
): Promise<McpToolResult> {
  const surface = ctx.surface ?? "mcp"
  const emit = (evt: Omit<McpToolEvent, "surface" | "tool">) =>
    ctx.observe?.({ surface, tool: name, ...evt })
  const fail = (error: string, outcome = "refused"): McpToolResult => {
    emit({ method: "", executed: false, ok: false, outcome, error })
    return { ok: false, tool: name, error }
  }

  const def = tools.find((t) => t.name === name)
  if (!def) {
    return fail(`Unknown tool: ${name}`)
  }

  const args = rawArgs || {}

  // --- Native tools: run in-process via the surface handler -------------------
  // Store discovery / key resolution etc. — no route, no write/rail gating
  // (natives are read-only). The surface owns execution and error shaping.
  if (def.native) {
    if (!ctx.runNative) {
      return fail(`Native tool '${name}' is not supported on this surface.`)
    }
    try {
      const result = await ctx.runNative(def.native, args)
      emit({
        method: "native",
        executed: true,
        ok: result.ok,
        outcome: "run",
        context: typeof args.context === "string" ? args.context : undefined,
      })
      return result
    } catch (e) {
      const error = `Error in native tool ${name}: ${(e as Error).message}`
      emit({ method: "native", executed: true, ok: false, outcome: "run", error })
      return { ok: false, tool: name, error }
    }
  }

  const dryRun = args.dry_run === true
  const confirmed = args.confirm === true
  const context = typeof args.context === "string" ? args.context : undefined
  const reason =
    typeof args.reason === "string" && args.reason.trim()
      ? args.reason.trim()
      : undefined
  const write = !!def.write
  // The store surface opts out of the confirm/reason rails (its DELETE is a
  // normal cart op). Partner/admin keep them.
  const railsOn = !ctx.disableSensitiveRails
  const sensitive = railsOn && isSensitive(def)
  const dangerous = railsOn && isDangerous(def)

  if (write && ctx.enableWrite === false) {
    return fail(
      ctx.writeDisabledMessage?.(name) ??
        `Tool '${name}' is a write tool and writes are disabled on this server.`
    )
  }
  // Dangerous tools are hidden + refused when the surface hasn't opted in.
  if (dangerous && ctx.enableDangerous === false) {
    return fail(
      `Tool '${name}' is a platform-destructive action and dangerous tools are disabled on this server.`
    )
  }

  // Resolve the tenant publishable key for multi-tenant (store) surfaces. A
  // `store` argument (handle/domain) wins and is resolved per-call; otherwise
  // the surface's default key applies. `store` is consumed here and never
  // forwarded to the route (it isn't in any registry's queryParams either).
  let publishableKey: string | undefined
  if (ctx.tenant) {
    publishableKey = ctx.tenant.defaultKey
    const storeArg = typeof args.store === "string" ? args.store.trim() : ""
    if (storeArg) {
      const resolved = ctx.tenant.resolveKey
        ? await ctx.tenant.resolveKey(storeArg)
        : null
      if (!resolved) {
        return fail(
          `No storefront / publishable key found for '${storeArg}'. Use list_stores to discover valid stores.`
        )
      }
      publishableKey = resolved
    }
    if (!publishableKey) {
      return fail(
        ctx.tenant.missingKeyMessage ??
          "No publishable key. Pass a `store` argument (see list_stores) or configure a default key on the server."
      )
    }
  }

  // Substitute path params for the target route.
  const sub = substitutePath(def.path as string, def.pathParams ?? [], args)
  if (sub.missing) {
    return fail(`Missing required parameter: ${sub.missing}`)
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
    ...(reason ? { reason } : {}),
  }

  // Fetch the current object for writes that declare a previewPath — so the
  // model (or the confirmation card) can show what is about to change.
  const fetchCurrent = async (): Promise<unknown> => {
    if (!def.previewPath) return undefined
    const psub = substitutePath(def.previewPath, def.pathParams ?? [], args)
    if (psub.missing) return undefined
    try {
      return await callMcpRoute({
        baseUrl: ctx.baseUrl,
        method: "GET",
        path: psub.path as string,
        bearer: ctx.bearer,
        cookie: ctx.cookie,
        publishableKey,
      })
    } catch {
      return undefined
    }
  }

  // --- Dry run: never execute -------------------------------------------------
  if (dryRun) {
    const current = write ? await fetchCurrent() : undefined
    emit({ method, path, executed: false, ok: true, outcome: "dry_run", context })
    return {
      ok: true,
      tool: name,
      dry_run: true,
      plan,
      ...(current !== undefined ? { current } : {}),
      warning: dangerous
        ? "This is a platform-destructive action; running it will require the user's confirmation AND a reason."
        : sensitive
        ? "This is a sensitive action; when you run it for real it will require the user's confirmation."
        : undefined,
    }
  }

  // --- Dangerous gate: require a human reason ---------------------------------
  if (dangerous && !reason) {
    const current = await fetchCurrent()
    emit({ method, path, executed: false, ok: true, outcome: "reason", context })
    return {
      ok: true,
      tool: name,
      requires_reason: true,
      requires_confirmation: true,
      plan,
      ...(current !== undefined ? { current } : {}),
      warning: `'${name}' is a platform-destructive action. It needs an explicit reason (why this is being done) and the user's confirmation before it runs.`,
    }
  }

  // --- Sensitive gate: require explicit confirm -------------------------------
  if (sensitive && !confirmed) {
    const current = await fetchCurrent()
    emit({ method, path, executed: false, ok: true, outcome: "confirm", context })
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
  const startedAt = Date.now()
  try {
    const data = await callMcpRoute({
      baseUrl: ctx.baseUrl,
      method,
      path,
      query,
      body,
      bearer: ctx.bearer,
      cookie: ctx.cookie,
      publishableKey,
      context,
      reason,
    })
    const out = def.transform ? def.transform(data, args) : data
    emit({
      method,
      path,
      executed: true,
      ok: true,
      outcome: "run",
      ms: Date.now() - startedAt,
      context,
    })
    return { ok: true, tool: name, data: out }
  } catch (e) {
    const err = e as McpProxyError
    const error = `Error calling ${name} (${path}): ${err.message}`
    emit({
      method,
      path,
      executed: true,
      ok: false,
      outcome: "run",
      ms: Date.now() - startedAt,
      error: err.message,
      context,
    })
    return { ok: false, tool: name, error }
  }
}
