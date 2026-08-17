/**
 * POST /mcp/admin — the Admin MCP endpoint for OAuth clients (#1306 Track B).
 *
 * ## Why this exists next to `/admin/mcp` rather than replacing it
 *
 * An RFC 9728 client discovers where to authenticate from a
 * `WWW-Authenticate: Bearer resource_metadata=…` header on a 401. Medusa's auth
 * middleware is applied in the loader BEFORE user middlewares, so on any
 * `/admin/*` path it answers `{"message":"Unauthorized"}` first and nothing we
 * register can attach that header. The mount therefore has to live outside
 * `/admin/*` and verify the bearer itself — which is all this file does before
 * delegating to the same handler `/admin/mcp` uses.
 *
 * `/admin/mcp` is unchanged and remains the endpoint for secret-API-key
 * clients, which need no discovery because they are configured by hand.
 *
 * Authorization is unaffected by the split: the token is a real admin user JWT,
 * so the dispatcher's loopback calls re-enter `/admin/*` and hit the per-route
 * scope guard exactly as they always have. This route adds one check the guard
 * cannot make — revocation — and applies it to reads as well as writes.
 */
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { getAuthContextFromJwtToken } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import {
  bearerChallenge,
  resolveOauthIssuer,
} from "../../../lib/mcp-oauth"
import {
  handleAdminMcpRequest,
  adminMcpMethodNotAllowed,
} from "../../admin/mcp/lib/handler"
import { MCP_OAUTH_MODULE } from "../../../modules/mcp_oauth"
import type McpOauthService from "../../../modules/mcp_oauth/service"

const unauthorized = (
  req: MedusaRequest,
  res: MedusaResponse,
  code: string,
  description: string
) => {
  const issuer = resolveOauthIssuer(req)
  res.setHeader(
    "www-authenticate",
    bearerChallenge(issuer, { code, description })
  )
  res.status(401).json({ error: code, error_description: description })
}

/**
 * Authenticate the request, or answer 401 with the discovery challenge.
 *
 * Returns true when the request may proceed. Deliberately uses the framework's
 * own JWT verification rather than a second implementation, so a token accepted
 * here is accepted identically on the `/admin/*` routes the dispatcher will
 * then call.
 */
const authenticateOrChallenge = async (
  req: MedusaRequest,
  res: MedusaResponse
): Promise<boolean> => {
  if (!req.get("authorization")) {
    return (
      unauthorized(
        req,
        res,
        "invalid_token",
        "Authorization required. Authorize at this server's OAuth endpoints."
      ),
      false
    )
  }

  const { projectConfig } = req.scope.resolve(
    ContainerRegistrationKeys.CONFIG_MODULE
  ) as any
  const http = projectConfig?.http ?? {}

  const authContext = getAuthContextFromJwtToken(
    req.get("authorization"),
    http.jwtSecret,
    ["bearer"],
    ["user"],
    http.jwtPublicKey,
    http.jwtVerifyOptions ?? http.jwtOptions
  ) as any

  if (!authContext?.actor_id) {
    return (
      unauthorized(
        req,
        res,
        "invalid_token",
        "The access token is missing, malformed, or expired."
      ),
      false
    )
  }

  // Revocation. A JWT verifies on its signature alone, so this is the only
  // thing standing between a revoked authorization and a full hour of further
  // access — and it covers reads, because a revoked token must not read either.
  const tokenId = authContext?.mcp_oauth?.token_id
  if (typeof tokenId === "string" && tokenId) {
    let row: any
    try {
      const oauth = req.scope.resolve(MCP_OAUTH_MODULE) as McpOauthService
      row = await oauth.getToken(tokenId)
    } catch {
      // Fail CLOSED: a permission check that cannot read the permission must
      // not grant it.
      res.status(503).json({
        error: "temporarily_unavailable",
        error_description:
          "Could not verify this token's status; refusing the request rather than assuming it is valid.",
      })
      return false
    }
    if (!row || row.revoked_at) {
      return (
        unauthorized(
          req,
          res,
          "invalid_token",
          "This authorization has been revoked."
        ),
        false
      )
    }
    // Best-effort usage stamp; never block the request on it.
    void (req.scope.resolve(MCP_OAUTH_MODULE) as McpOauthService)
      .updateMcpOauthTokens([{ id: tokenId, last_used_at: new Date() }])
      .catch(() => {})
  }

  ;(req as any).auth_context = authContext
  return true
}

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  if (!(await authenticateOrChallenge(req, res))) return
  await handleAdminMcpRequest(req, res)
}

/**
 * 405 for GET/DELETE is spec-compliant for a stateless Streamable-HTTP server
 * that offers no SSE stream — but only once the caller is authenticated. An
 * unauthenticated GET still gets the 401 challenge, because some clients probe
 * with GET first and that probe is a discovery opportunity.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  if (!(await authenticateOrChallenge(req, res))) return
  adminMcpMethodNotAllowed(req, res)
}

export const DELETE = GET
