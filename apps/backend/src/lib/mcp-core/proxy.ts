/**
 * Shared MCP core — loopback proxy.
 *
 * MCP tools call `callMcpRoute` to forward their arguments to a real route
 * (`/store/*`, `/partners/*`, `/admin/*`) over HTTP on the same process,
 * attaching the caller's auth (JWT bearer and/or session cookie). Going through
 * HTTP — vs re-implementing route logic here — means every tool inherits the
 * exact middleware the route already runs: `authenticate(...)` scoping,
 * `validateAndTransformBody` validators, and any custom route logic. Wrapping a
 * new endpoint becomes a single registry row.
 */
import qs from "qs"

export type McpProxyArgs = {
  /** Base origin of this backend, e.g. http://localhost:9000 (no trailing slash). */
  baseUrl: string
  /** HTTP method. Defaults to GET (read tools). */
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE"
  /** Route path with params already substituted, e.g. /admin/orders/order_1. */
  path: string
  /** Query params to forward. Arrays are serialized as key[]=a&key[]=b. */
  query?: Record<string, unknown>
  /**
   * JSON request body for write tools. Sent as application/json. The wrapped
   * route's own `validateAndTransformBody` validator runs on it, so the
   * MCP-side schema stays permissive and Medusa remains the source of truth.
   */
  body?: Record<string, unknown>
  /** Auth header to forward (JWT). Required for authenticated routes. */
  bearer?: string
  /** Optional session cookie to forward when the caller authed via cookie. */
  cookie?: string
  /**
   * Publishable key for sales-channel scoping (store surface). Forwarded as the
   * `x-publishable-api-key` header so `/store/*` routes resolve the right
   * storefront. Ignored by single-tenant (partner/admin) surfaces.
   */
  publishableKey?: string
  /**
   * Optional agent intent ("what am I trying to accomplish") forwarded as the
   * `x-mcp-context` header. Purely informational — routes/telemetry can log it
   * to understand multi-step tool sequences; it never affects route logic.
   */
  context?: string
  /**
   * Optional human-supplied reason for a `dangerous` action, forwarded as the
   * `x-mcp-reason` header so the wrapped route (and the audit log) can record
   * why a platform-destructive mutation was performed.
   */
  reason?: string
}

export type McpProxyError = Error & { status?: number; body?: unknown }

export async function callMcpRoute({
  baseUrl,
  method = "GET",
  path,
  query,
  body,
  bearer,
  cookie,
  publishableKey,
  context,
  reason,
}: McpProxyArgs): Promise<unknown> {
  const qstr =
    query && Object.keys(query).length
      ? `?${qs.stringify(query, { arrayFormat: "brackets", skipNulls: true })}`
      : ""
  const url = `${baseUrl}${path}${qstr}`

  const headers: Record<string, string> = { accept: "application/json" }
  if (bearer) {
    // Forward an already-schemed header VERBATIM; only a bare token gets the
    // Bearer prefix.
    //
    // `Basic` matters as much as `Bearer`: a Medusa secret API key authenticates
    // over HTTP Basic and ONLY over Basic (the framework returns a pointed 401
    // when one arrives as a Bearer token). Prefixing unconditionally turned
    // `Basic <b64>` into `Bearer Basic <b64>`, so every tool CALL from an
    // API-key-authenticated MCP client 401'd on the loopback — while
    // `initialize` and `tools/list`, which never touch a route, kept working.
    // That combination is why the surface looked functional for a key holder.
    const scheme = bearer.trim().split(" ")[0].toLowerCase()
    headers["authorization"] =
      scheme === "bearer" || scheme === "basic" ? bearer : `Bearer ${bearer}`
  }
  if (cookie) {
    headers["cookie"] = cookie
  }
  if (publishableKey) {
    headers["x-publishable-api-key"] = publishableKey
  }
  if (context) {
    // Header values must be Latin-1 byte strings — undici rejects anything
    // outside 0x00-0xFF ("Cannot convert argument to a ByteString"). The model
    // often writes an em dash / curly quote into its intent, which would abort
    // the fetch before it ever reaches the route. Collapse those to "?" and
    // truncate defensively.
    headers["x-mcp-context"] = context.replace(/[^\x00-\xFF]/g, "?").slice(0, 1024)
  }
  if (reason) {
    headers["x-mcp-reason"] = reason.replace(/[^\x00-\xFF]/g, "?").slice(0, 1024)
  }

  const init: RequestInit = { method, headers }
  // Attach a JSON body for writes. GET never carries a body.
  if (method !== "GET" && body && Object.keys(body).length) {
    headers["content-type"] = "application/json"
    init.body = JSON.stringify(body)
  }

  const resp = await fetch(url, init)
  const text = await resp.text()

  let json: any = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    json = { raw: text }
  }

  if (!resp.ok) {
    // Routes shape their failures inconsistently: some return `{ message }`,
    // most of this repo's return `{ error }`, and zod-driven ones add a
    // `details` array. Surfacing all three turns a bare "HTTP 400" into
    // something the model can act on (and the observability log can be read
    // without re-running the call).
    const message = json?.message || json?.error || json?.type || `HTTP ${resp.status}`
    const details = json?.details
    const err: McpProxyError = new Error(
      `Route ${path} responded ${resp.status}: ${message}` +
        (details ? ` — ${JSON.stringify(details).slice(0, 500)}` : "")
    )
    err.status = resp.status
    err.body = json
    throw err
  }

  return json
}
