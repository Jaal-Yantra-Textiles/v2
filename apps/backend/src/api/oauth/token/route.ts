/**
 * POST /oauth/token — PKCE code exchange and refresh (#1306 Track B).
 *
 * Accepts both `application/x-www-form-urlencoded` (what RFC 6749 specifies and
 * most clients send) and JSON. No parser of our own is needed: Medusa's body
 * parser stack already applies `express.urlencoded` to every route. ⚠️ Adding a
 * second one does not just duplicate work, it hangs the request — the stream is
 * already consumed, so the `end` event a hand-rolled parser waits on never
 * fires.
 *
 * What comes back is a Medusa **user** JWT carrying an `mcp_oauth.token_id`
 * claim — see `src/lib/mcp-oauth.ts` for why it cannot be anything else. Two
 * rows are written alongside it:
 *
 *   - `mcp_oauth_token`   — the authorization, so it can be revoked; and
 *   - `mcp_access_scope`  — the Track C row keyed on `("oauth", token_id)`,
 *     which is what is actually ENFORCED, on the MCP tool surface and on plain
 *     `/admin/*` writes alike.
 *
 * 🔑 Refreshing keeps the same `token_id`. The scope row is attached to it, so
 * rotating the refresh token must not mint a new identity — otherwise the
 * credential would quietly climb back to the process ceiling on first refresh.
 */
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import {
  MCP_OAUTH_ACCESS_TTL_SEC,
  MCP_OAUTH_REFRESH_TTL_SEC,
  asScopeLevel,
  levelToScopeString,
  mintAccessToken,
  randomSecret,
  resolveJwtSecret,
  secretsMatch,
  sha256,
  verifyPkce,
} from "../../../lib/mcp-oauth"
import { MCP_ACCESS_MODULE } from "../../../modules/mcp_access"
import type McpAccessService from "../../../modules/mcp_access/service"
import { MCP_OAUTH_MODULE } from "../../../modules/mcp_oauth"
import type McpOauthService from "../../../modules/mcp_oauth/service"

const fail = (
  res: MedusaResponse,
  status: number,
  error: string,
  description: string
) => {
  res.setHeader("cache-control", "no-store")
  res.status(status).json({ error, error_description: description })
}

/** `client_secret_basic` credentials, if the client used that method. */
const basicCredentials = (
  header: string | undefined
): { id: string; secret: string } | null => {
  if (!header?.toLowerCase().startsWith("basic ")) return null
  try {
    const decoded = Buffer.from(header.slice(6).trim(), "base64").toString(
      "utf-8"
    )
    const idx = decoded.indexOf(":")
    if (idx < 0) return null
    return {
      id: decodeURIComponent(decoded.slice(0, idx)),
      secret: decodeURIComponent(decoded.slice(idx + 1)),
    }
  } catch {
    return null
  }
}

/**
 * Confirm the caller is the registered client.
 *
 * A public client proves nothing here — PKCE is what binds the code to it, and
 * demanding a secret it does not have would just lock out the clients this
 * whole track exists for.
 */
const clientAuthenticated = (
  client: any,
  providedSecret: string | undefined
): boolean => {
  if (!client.client_secret_hash) return true
  if (!providedSecret) return false
  return secretsMatch(sha256(providedSecret), client.client_secret_hash)
}

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const body = (req.body ?? {}) as Record<string, any>
  const basic = basicCredentials(req.get("authorization"))

  const grantType = String(body.grant_type || "")
  const clientId = String(body.client_id || basic?.id || "")
  const clientSecret = (body.client_secret as string) || basic?.secret

  if (!clientId) {
    return fail(res, 400, "invalid_client", "client_id is required.")
  }

  const oauth = req.scope.resolve(MCP_OAUTH_MODULE) as McpOauthService
  const client = await oauth.getClient(clientId)
  if (!client) {
    return fail(res, 401, "invalid_client", "Unknown client_id.")
  }
  if (!clientAuthenticated(client, clientSecret)) {
    return fail(res, 401, "invalid_client", "Client authentication failed.")
  }

  const secret = resolveJwtSecret(req)
  if (!secret) {
    return fail(
      res,
      500,
      "server_error",
      "JWT secret not configured (projectConfig.http.jwtSecret)."
    )
  }

  /** Mint an access token for an existing authorization row. */
  const issue = async (token: any, refreshToken: string) => {
    const level = asScopeLevel(token.level)
    const accessToken = mintAccessToken({
      secret,
      userId: token.user_id,
      authIdentityId: token.auth_identity_id,
      tokenId: token.id,
    })
    res.setHeader("cache-control", "no-store")
    return res.json({
      access_token: accessToken,
      token_type: "Bearer",
      expires_in: MCP_OAUTH_ACCESS_TTL_SEC,
      refresh_token: refreshToken,
      scope: levelToScopeString(level),
    })
  }

  if (grantType === "authorization_code") {
    const code = String(body.code || "")
    const codeVerifier = String(body.code_verifier || "")
    const redirectUri = String(body.redirect_uri || "")
    if (!code || !codeVerifier) {
      return fail(
        res,
        400,
        "invalid_request",
        "code and code_verifier are required."
      )
    }

    const grant = await oauth.getGrantByCodeHash(sha256(code))
    if (!grant || grant.client_id !== clientId) {
      return fail(res, 400, "invalid_grant", "Unknown or foreign code.")
    }

    if (grant.consumed_at) {
      // A second redemption means the code leaked. Kill what it produced —
      // whoever holds it now, we cannot tell which redemption was the honest
      // one, so neither party keeps access.
      const issuedTokenId = (grant.metadata as any)?.token_id
      if (typeof issuedTokenId === "string" && issuedTokenId) {
        await oauth.revokeToken(issuedTokenId)
      }
      return fail(
        res,
        400,
        "invalid_grant",
        "This authorization code was already used. Any token it issued has been revoked; start a new authorization."
      )
    }
    if (new Date(grant.expires_at).getTime() <= Date.now()) {
      return fail(res, 400, "invalid_grant", "Authorization code expired.")
    }
    if (redirectUri && redirectUri !== grant.redirect_uri) {
      return fail(
        res,
        400,
        "invalid_grant",
        "redirect_uri does not match the one used at authorization."
      )
    }
    if (
      !verifyPkce(grant.code_challenge, grant.code_challenge_method, codeVerifier)
    ) {
      return fail(res, 400, "invalid_grant", "PKCE verification failed.")
    }

    const level = asScopeLevel(grant.level)
    const refreshToken = randomSecret(32)
    const now = Date.now()

    const created = await oauth.createMcpOauthTokens({
      client_id: clientId,
      user_id: grant.user_id,
      auth_identity_id: grant.auth_identity_id || null,
      level,
      refresh_token_hash: sha256(refreshToken),
      access_expires_at: new Date(now + MCP_OAUTH_ACCESS_TTL_SEC * 1000),
      refresh_expires_at: new Date(now + MCP_OAUTH_REFRESH_TTL_SEC * 1000),
      metadata: { grant_id: grant.id, client_name: client.client_name },
    })
    const token = Array.isArray(created) ? created[0] : created

    // The scope row is the enforcement point — write it BEFORE handing the
    // access token out. Absent a row a principal gets the process ceiling, so
    // the wrong order would leave a `read` client briefly unrestricted.
    const access = req.scope.resolve(MCP_ACCESS_MODULE) as McpAccessService
    await access.setScope({
      principal_type: "oauth",
      principal_id: token.id,
      level,
      label: client.client_name,
      note: `OAuth client ${clientId}, authorized by user ${grant.user_id}`,
    })

    await oauth.updateMcpOauthGrants([
      {
        id: grant.id,
        consumed_at: new Date(),
        metadata: { ...(grant.metadata || {}), token_id: token.id },
      },
    ])

    return issue(token, refreshToken)
  }

  if (grantType === "refresh_token") {
    const refreshToken = String(body.refresh_token || "")
    if (!refreshToken) {
      return fail(res, 400, "invalid_request", "refresh_token is required.")
    }
    const token = await oauth.getTokenByRefreshHash(sha256(refreshToken))
    if (!token || token.client_id !== clientId) {
      return fail(res, 400, "invalid_grant", "Unknown refresh token.")
    }
    if (token.revoked_at) {
      return fail(res, 400, "invalid_grant", "This authorization was revoked.")
    }
    if (
      token.refresh_expires_at &&
      new Date(token.refresh_expires_at).getTime() <= Date.now()
    ) {
      return fail(res, 400, "invalid_grant", "Refresh token expired.")
    }

    // Rotate the refresh token, keep the authorization id. The scope row hangs
    // off that id, so reusing it is what keeps the credential's level pinned
    // across the whole lifetime of the grant.
    const next = randomSecret(32)
    const now = Date.now()
    await oauth.updateMcpOauthTokens([
      {
        id: token.id,
        refresh_token_hash: sha256(next),
        access_expires_at: new Date(now + MCP_OAUTH_ACCESS_TTL_SEC * 1000),
        refresh_expires_at: new Date(now + MCP_OAUTH_REFRESH_TTL_SEC * 1000),
        last_used_at: new Date(),
      },
    ])

    return issue(token, next)
  }

  return fail(
    res,
    400,
    "unsupported_grant_type",
    `Unsupported grant_type: ${grantType || "(none)"}. This server supports ` +
      `authorization_code and refresh_token.`
  )
}
