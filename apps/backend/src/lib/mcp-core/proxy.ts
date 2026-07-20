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
  method?: "GET" | "POST" | "PUT" | "DELETE"
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
    headers["authorization"] = bearer.toLowerCase().startsWith("bearer ")
      ? bearer
      : `Bearer ${bearer}`
  }
  if (cookie) {
    headers["cookie"] = cookie
  }
  if (context) {
    // Truncate defensively — this is a header, not a payload.
    headers["x-mcp-context"] = context.slice(0, 1024)
  }
  if (reason) {
    headers["x-mcp-reason"] = reason.slice(0, 1024)
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
    const message = json?.message || json?.type || `HTTP ${resp.status}`
    const err: McpProxyError = new Error(
      `Route ${path} responded ${resp.status}: ${message}`
    )
    err.status = resp.status
    err.body = json
    throw err
  }

  return json
}
