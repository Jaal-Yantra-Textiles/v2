/**
 * Loopback proxy to the Store API.
 *
 * MCP tools call this to forward arguments to a real `/store/*` route over
 * HTTP on the same process, attaching the resolved publishable key (and an
 * optional customer bearer for future authed tools). Going through HTTP — vs
 * re-querying query.graph here — means we inherit every middleware the store
 * route already runs: publishable-key scoping, pricing/tax context, validators,
 * and our custom overrides. New store endpoints become one registry row.
 */
import qs from "qs"

export type ProxyArgs = {
  /** Base origin of this backend, e.g. http://localhost:9000 (no trailing slash). */
  baseUrl: string
  /** HTTP method. Defaults to GET (read tools). Write tools use POST/DELETE. */
  method?: "GET" | "POST" | "DELETE"
  /** Store route path with params already substituted, e.g. /store/products/prod_1. */
  path: string
  /** Query params to forward. Arrays are serialized as key[]=a&key[]=b. */
  query?: Record<string, unknown>
  /**
   * JSON request body for write tools (POST/DELETE). Sent as application/json.
   * The store route's own `validateAndTransformBody` validator runs on it, so we
   * keep the MCP-side schema permissive and let Medusa be the source of truth.
   */
  body?: Record<string, unknown>
  /** Publishable key for sales-channel scoping (required by /store/*). */
  publishableKey?: string
  /** Optional customer auth header to forward (reserved for authed tools). */
  bearer?: string
}

export type ProxyError = Error & { status?: number; body?: unknown }

export async function callStoreRoute({
  baseUrl,
  method = "GET",
  path,
  query,
  body,
  publishableKey,
  bearer,
}: ProxyArgs): Promise<unknown> {
  const qstr =
    query && Object.keys(query).length
      ? `?${qs.stringify(query, { arrayFormat: "brackets", skipNulls: true })}`
      : ""
  const url = `${baseUrl}${path}${qstr}`

  const headers: Record<string, string> = { accept: "application/json" }
  if (publishableKey) {
    headers["x-publishable-api-key"] = publishableKey
  }
  if (bearer) {
    headers["authorization"] = bearer.toLowerCase().startsWith("bearer ")
      ? bearer
      : `Bearer ${bearer}`
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
    const err: ProxyError = new Error(
      `Store route ${path} responded ${resp.status}: ${message}`
    )
    err.status = resp.status
    err.body = json
    throw err
  }

  return json
}
