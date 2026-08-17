/**
 * POST /oauth/revoke — RFC 7009 token revocation (#1306 Track B).
 *
 * Accepts either a refresh token or an access token as `token`, and always
 * answers 200. RFC 7009 §2.2 is explicit about that: an unknown token is
 * already in the desired state, and distinguishing "revoked" from "never
 * existed" would turn this endpoint into a token oracle.
 *
 * Revoking kills the whole authorization, not just the presented token —
 * `mcp_oauth_token` is one row per grant, and a client asking us to forget one
 * half of a pair it holds both of is not a case worth modelling.
 */
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import jwt from "jsonwebtoken"
import {
  resolveJwtSecret,
  secretsMatch,
  sha256,
} from "../../../lib/mcp-oauth"
import { MCP_OAUTH_MODULE } from "../../../modules/mcp_oauth"
import type McpOauthService from "../../../modules/mcp_oauth/service"

/** The `token_id` inside an access token, verified. */
const tokenIdFromAccessToken = (
  value: string,
  secret: string | null
): string | null => {
  if (!secret) return null
  try {
    const payload = jwt.verify(value, secret) as any
    const id = payload?.mcp_oauth?.token_id
    return typeof id === "string" && id ? id : null
  } catch {
    return null
  }
}

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const body = (req.body ?? {}) as Record<string, any>
  const presented = String(body.token || "")
  res.setHeader("cache-control", "no-store")
  if (!presented) {
    return res.status(200).json({})
  }

  const oauth = req.scope.resolve(MCP_OAUTH_MODULE) as McpOauthService

  // A refresh token first — it is the opaque one, so a hash lookup either
  // matches or does not, with nothing to verify.
  const byRefresh = await oauth.getTokenByRefreshHash(sha256(presented))
  let tokenId: string | null = byRefresh?.id ?? null

  if (!tokenId) {
    tokenId = tokenIdFromAccessToken(presented, resolveJwtSecret(req))
  }

  if (tokenId) {
    const row = await oauth.getToken(tokenId)
    // A client may only revoke its own authorization. Without this check any
    // registered client could revoke another's by guessing an id — and ids are
    // not secrets, they appear in scope rows and audit output.
    const clientId = String(body.client_id || "")
    if (row && (!clientId || secretsMatch(clientId, row.client_id))) {
      await oauth.revokeToken(tokenId)
    }
  }

  return res.status(200).json({})
}
