/**
 * Loopback proxy to the Partner API.
 *
 * Partner MCP tools call this to forward their arguments to a real
 * `/partners/*` route over HTTP on the same process, attaching the calling
 * partner's auth (JWT bearer and/or session cookie). Going through HTTP — vs
 * re-implementing the logic here — means every tool inherits the exact
 * middleware the partner route already runs: `authenticate("partner", …)`
 * ownership scoping, `validateAndTransformBody` validators, and any custom
 * route logic. Wrapping a new partner endpoint becomes a single registry row.
 */
import qs from "qs"

export type PartnerProxyArgs = {
  /** Base origin of this backend, e.g. http://localhost:9000 (no trailing slash). */
  baseUrl: string
  /** HTTP method. Defaults to GET (read tools). */
  method?: "GET" | "POST" | "PUT" | "DELETE"
  /** Partner route path with params already substituted, e.g. /partners/products/prod_1. */
  path: string
  /** Query params to forward. Arrays are serialized as key[]=a&key[]=b. */
  query?: Record<string, unknown>
  /**
   * JSON request body for write tools. Sent as application/json. The partner
   * route's own `validateAndTransformBody` validator runs on it, so the
   * MCP-side schema stays permissive and Medusa remains the source of truth.
   */
  body?: Record<string, unknown>
  /** Partner auth header to forward (JWT). Required for authenticated routes. */
  bearer?: string
  /** Optional session cookie to forward when the caller authed via cookie. */
  cookie?: string
}

export type PartnerProxyError = Error & { status?: number; body?: unknown }

export async function callPartnerRoute({
  baseUrl,
  method = "GET",
  path,
  query,
  body,
  bearer,
  cookie,
}: PartnerProxyArgs): Promise<unknown> {
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
    const err: PartnerProxyError = new Error(
      `Partner route ${path} responded ${resp.status}: ${message}`
    )
    err.status = resp.status
    err.body = json
    throw err
  }

  return json
}
