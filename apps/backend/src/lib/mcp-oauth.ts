/**
 * OAuth 2.1 + PKCE front door for the Admin MCP surface — the pure half
 * (#1306 Track B).
 *
 * ## Why the token is a Medusa *user* JWT
 *
 * The obvious design — an access token carrying `actor_type: "oauth"` — cannot
 * work. Medusa authenticates `/admin/*` with `actorType: "user"` and
 * `isActorTypePermitted` 401s every other actor type
 * (`@medusajs/framework/dist/http/middlewares/authenticate-middleware.js`), so
 * such a token is rejected at the door and never reaches our scope guard. API
 * keys are the one hard-coded exception, and only over HTTP Basic.
 *
 * So the access token IS a normal admin user JWT — `actor_type: "user"`,
 * `actor_id` = the admin who approved the consent — with one extra claim:
 *
 *     mcp_oauth: { token_id: "mcpt_…" }
 *
 * The framework verifies it like any other bearer and, because it assigns the
 * whole verified payload to `req.auth_context`, the claim arrives intact
 * without any parsing of our own. `mcpPrincipalFromRequest` reads it and
 * returns `{ type: "oauth", id: token_id }` while leaving `auth_context`
 * untouched, so:
 *
 *   - the #1310 per-route tier guard and the Track C `mcp_access_scope` row
 *     apply for free, bound to the TOKEN rather than to the user; and
 *   - every admin route that reads `actor_id` as a user id (audit trails,
 *     `created_by`) still sees a real user.
 *
 * ⚠️ Do NOT rewrite `auth_context.actor_type` to `"oauth"` to achieve the same
 * thing. It breaks the second point above, silently.
 *
 * ⚠️ `projectConfig.http.jwtExpiresIn` is GLOBAL — shortening it would shorten
 * every dashboard session. OAuth access tokens are signed with their own
 * `expiresIn` instead.
 *
 * Everything in this file is pure or reads env/config only; storage lives in
 * the `mcp_oauth` module and the flow decisions live in `src/api/oauth/*`.
 */
import crypto from "crypto"
import jwt from "jsonwebtoken"
import type { MedusaRequest } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { MCP_SCOPE_LEVELS, isMcpScopeLevel } from "./mcp-core/tiers"
import type { McpScopeLevel } from "./mcp-core/tiers"

/**
 * The MCP endpoint this authorization server protects.
 *
 * Deliberately NOT `/admin/mcp`. An RFC 9728 client discovers the
 * authorization server from a `WWW-Authenticate: Bearer resource_metadata=…`
 * header on a 401 — and nothing we register can put that header on a
 * `/admin/*` 401, because the framework's auth middleware is applied in the
 * loader BEFORE user middlewares and answers first. A mount outside `/admin/*`
 * verifies the bearer itself and can therefore emit the challenge.
 *
 * `/admin/mcp` stays exactly as it is for secret-API-key clients.
 */
export const MCP_OAUTH_RESOURCE_PATH = "/mcp/admin"

/** Access-token lifetime. Short: revocation is a DB read on every request, but
 *  a short window limits the damage if that check is ever bypassed. */
export const MCP_OAUTH_ACCESS_TTL_SEC = 60 * 60

/** Refresh-token lifetime, rotated on every use. */
export const MCP_OAUTH_REFRESH_TTL_SEC = 60 * 60 * 24 * 30

/** Authorization codes live only long enough to be redeemed once. */
export const MCP_OAUTH_CODE_TTL_SEC = 300

/** Consent screens older than this are stale; the client must restart. */
export const MCP_OAUTH_REQUEST_TTL_SEC = 600

/** The scope string prefix. `mcp:read` … `mcp:dangerous` mirror the ladder. */
export const MCP_OAUTH_SCOPE_PREFIX = "mcp:"

/** Every scope string this server understands, widest last. */
export const MCP_OAUTH_SCOPES: readonly string[] = MCP_SCOPE_LEVELS.map(
  (l) => `${MCP_OAUTH_SCOPE_PREFIX}${l}`
)

export const levelToScopeString = (level: McpScopeLevel): string =>
  `${MCP_OAUTH_SCOPE_PREFIX}${level}`

/**
 * The widest rung named in a space-separated `scope` parameter, or null when
 * the client asked for nothing recognizable.
 *
 * Unknown entries are ignored rather than rejected: clients routinely send
 * extra scopes (`openid`, `offline_access`) and failing the whole request over
 * one would break a connection that we can serve perfectly well. The admin
 * picks the actual rung at consent, so a generous parse grants nothing.
 */
export const levelFromScopeString = (
  scope: string | undefined | null
): McpScopeLevel | null => {
  if (!scope) return null
  const asked = new Set(
    String(scope)
      .split(/\s+/)
      .filter(Boolean)
      .map((s) => s.replace(MCP_OAUTH_SCOPE_PREFIX, ""))
  )
  let widest: McpScopeLevel | null = null
  for (const level of MCP_SCOPE_LEVELS) {
    if (asked.has(level)) widest = level
  }
  return widest
}

/** sha256, hex. Used for every stored secret in this flow. */
export const sha256 = (value: string): string =>
  crypto.createHash("sha256").update(value).digest("hex")

/** A URL-safe random secret. 32 bytes → 43 base64url chars. */
export const randomSecret = (bytes = 32): string =>
  crypto.randomBytes(bytes).toString("base64url")

/**
 * Constant-time string comparison, for client secrets and code hashes.
 *
 * `crypto.timingSafeEqual` throws on length mismatch, which would itself leak
 * length — so compare digests, which are always the same size.
 */
export const secretsMatch = (a: string, b: string): boolean => {
  const ha = crypto.createHash("sha256").update(a).digest()
  const hb = crypto.createHash("sha256").update(b).digest()
  return crypto.timingSafeEqual(ha, hb)
}

/**
 * PKCE verification (RFC 7636).
 *
 * `plain` is rejected at the authorize endpoint, so in practice this only ever
 * sees S256 — it still handles both, because a stored grant should be
 * self-describing rather than depending on today's validation staying put.
 */
export const verifyPkce = (
  codeChallenge: string,
  method: string,
  codeVerifier: string
): boolean => {
  if (!codeChallenge || !codeVerifier) return false
  // RFC 7636 §4.1: 43–128 characters from the unreserved set.
  if (codeVerifier.length < 43 || codeVerifier.length > 128) return false
  if ((method || "S256").toUpperCase() === "PLAIN") {
    return secretsMatch(codeChallenge, codeVerifier)
  }
  const derived = crypto
    .createHash("sha256")
    .update(codeVerifier)
    .digest("base64url")
  return secretsMatch(codeChallenge, derived)
}

/**
 * The public origin this server is reached at — the OAuth `issuer`.
 *
 * Honours `x-forwarded-proto` because behind the ALB `req.protocol` is `http`,
 * and an `http://` issuer is rejected outright by conforming clients. Override
 * with `MCP_OAUTH_ISSUER` when the public hostname differs from the Host header.
 */
export const resolveOauthIssuer = (req: MedusaRequest): string => {
  const override = process.env.MCP_OAUTH_ISSUER
  if (override) return override.replace(/\/+$/, "")
  const forwarded = (req.get("x-forwarded-proto") || "").split(",")[0].trim()
  const proto = forwarded || (req.protocol || "http").split(",")[0].trim()
  const host = req.get("host") || `localhost:${process.env.PORT || "9000"}`
  return `${proto}://${host}`
}

/**
 * A redirect URI is acceptable only if the client registered it VERBATIM.
 *
 * No prefix matching, no wildcards, no ignoring the query string — loose
 * matching here is the classic open-redirect hole that turns an authorization
 * server into a token-exfiltration service.
 */
export const redirectUriRegistered = (
  registered: unknown,
  candidate: string
): boolean => {
  if (!candidate) return false
  const list = Array.isArray(registered) ? registered : []
  return list.some((u) => typeof u === "string" && u === candidate)
}

/**
 * Redirect targets we accept at registration.
 *
 * Loopback (any port — RFC 8252 §7.3 requires the port to be ignored, and
 * desktop clients pick a random one) and https elsewhere. Custom app schemes
 * (`cursor://`, `claude://`) are allowed because native clients depend on them
 * and they are not interceptable over the network.
 */
export const isAcceptableRedirectUri = (value: string): boolean => {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return false
  }
  if (url.hash) return false // RFC 6749 §3.1.2 — no fragment component
  if (url.protocol === "https:") return true
  if (
    url.protocol === "http:" &&
    (url.hostname === "127.0.0.1" ||
      url.hostname === "::1" ||
      url.hostname === "localhost")
  ) {
    return true
  }
  // A private-use scheme: must contain a dot, per RFC 8252 §7.1.
  return /^[a-z][a-z0-9+.-]*:$/.test(url.protocol) && url.protocol.includes(".")
}

/** The configured JWT secret, or null when the deployment has none. */
export const resolveJwtSecret = (req: MedusaRequest): string | null => {
  try {
    const configModule = req.scope.resolve(
      ContainerRegistrationKeys.CONFIG_MODULE
    ) as any
    const secret = configModule?.projectConfig?.http?.jwtSecret
    return typeof secret === "string" && secret ? secret : null
  } catch {
    return null
  }
}

export type MintAccessTokenInput = {
  secret: string
  userId: string
  authIdentityId?: string | null
  tokenId: string
  expiresInSec?: number
}

/**
 * Sign an access token.
 *
 * The payload shape is exactly what Medusa's `generateJwtTokenForAuthIdentity`
 * produces — the framework reads `actor_id` / `actor_type` /
 * `auth_identity_id` off it — plus the `mcp_oauth` claim. Signed with its own
 * `expiresIn`, never the global `jwtExpiresIn`.
 */
export const mintAccessToken = ({
  secret,
  userId,
  authIdentityId,
  tokenId,
  expiresInSec = MCP_OAUTH_ACCESS_TTL_SEC,
}: MintAccessTokenInput): string =>
  jwt.sign(
    {
      actor_id: userId,
      actor_type: "user",
      auth_identity_id: authIdentityId ?? "",
      app_metadata: { user_id: userId },
      mcp_oauth: { token_id: tokenId },
    },
    secret,
    { expiresIn: expiresInSec }
  )

/**
 * The `mcp_oauth.token_id` claim on an authenticated request, or null.
 *
 * Reads `req.auth_context`, which the framework sets to the *entire* verified
 * JWT payload — so an unverified token can never reach this, and no separate
 * parse of the Authorization header is needed.
 */
export const mcpOauthTokenIdFromRequest = (
  req: MedusaRequest
): string | null => {
  const claim = (req as any).auth_context?.mcp_oauth
  const id = claim?.token_id
  return typeof id === "string" && id ? id : null
}

/**
 * RFC 9728 protected-resource metadata. Points a client at this same origin as
 * its own authorization server — we are both, which keeps the discovery chain
 * one hop long.
 */
export const protectedResourceMetadata = (issuer: string) => ({
  resource: `${issuer}${MCP_OAUTH_RESOURCE_PATH}`,
  authorization_servers: [issuer],
  scopes_supported: MCP_OAUTH_SCOPES,
  bearer_methods_supported: ["header"],
  resource_documentation: `${issuer}/oauth/authorize`,
})

/** RFC 8414 authorization-server metadata. */
export const authorizationServerMetadata = (issuer: string) => ({
  issuer,
  authorization_endpoint: `${issuer}/oauth/authorize`,
  token_endpoint: `${issuer}/oauth/token`,
  registration_endpoint: `${issuer}/oauth/register`,
  revocation_endpoint: `${issuer}/oauth/revoke`,
  scopes_supported: MCP_OAUTH_SCOPES,
  response_types_supported: ["code"],
  grant_types_supported: ["authorization_code", "refresh_token"],
  // S256 only. `plain` offers no protection against a code intercepted on the
  // redirect leg, which is the single thing PKCE exists to stop.
  code_challenge_methods_supported: ["S256"],
  token_endpoint_auth_methods_supported: [
    "none",
    "client_secret_post",
    "client_secret_basic",
  ],
  revocation_endpoint_auth_methods_supported: ["none", "client_secret_post"],
})

/**
 * The `WWW-Authenticate` challenge an MCP client follows to find all of the
 * above. This header is the entire reason the OAuth mount lives outside
 * `/admin/*`.
 */
export const bearerChallenge = (
  issuer: string,
  error?: { code: string; description: string }
): string => {
  const parts = [
    `Bearer realm="jyt-admin-mcp"`,
    `resource_metadata="${issuer}/.well-known/oauth-protected-resource"`,
  ]
  if (error) {
    parts.push(`error="${error.code}"`)
    parts.push(`error_description="${error.description.replace(/"/g, "'")}"`)
  }
  return parts.join(", ")
}

/** Narrow an arbitrary stored string back onto the ladder, failing safe. */
export const asScopeLevel = (value: unknown): McpScopeLevel =>
  typeof value === "string" && isMcpScopeLevel(value) ? value : "read"
