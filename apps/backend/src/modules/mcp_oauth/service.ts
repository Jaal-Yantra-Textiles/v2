import { MedusaService } from "@medusajs/framework/utils"
import McpOauthClient from "./models/mcp-oauth-client"
import McpOauthGrant from "./models/mcp-oauth-grant"
import McpOauthToken from "./models/mcp-oauth-token"

/**
 * The OAuth 2.1 front door's data access (#1306 Track B).
 *
 * Deliberately thin: it hashes nothing and decides nothing about the protocol.
 * All the crypto (code/secret generation, sha256, PKCE verification) lives in
 * `src/lib/mcp-oauth.ts` so it can be unit-tested without a container, and the
 * flow decisions live in the routes. This class only stores and looks up.
 */
class McpOauthService extends MedusaService({
  McpOauthClient,
  McpOauthGrant,
  McpOauthToken,
}) {
  /** A registered client by its public `client_id`, or null. */
  async getClient(clientId: string): Promise<any | null> {
    if (!clientId) return null
    const rows = await this.listMcpOauthClients({ client_id: clientId })
    return rows?.[0] ?? null
  }

  /**
   * A pending grant by the hash of its code, or null.
   *
   * Returns consumed and expired rows too — the caller must distinguish them,
   * because "this code was already used" is a security event worth acting on
   * while "no such code" is merely a bad request.
   */
  async getGrantByCodeHash(codeHash: string): Promise<any | null> {
    if (!codeHash) return null
    const rows = await this.listMcpOauthGrants({ code_hash: codeHash })
    return rows?.[0] ?? null
  }

  async getTokenByRefreshHash(refreshHash: string): Promise<any | null> {
    if (!refreshHash) return null
    const rows = await this.listMcpOauthTokens({
      refresh_token_hash: refreshHash,
    })
    return rows?.[0] ?? null
  }

  /**
   * One token row by id — the revocation check, run on every `/admin/*`
   * request made with an OAuth-minted JWT.
   *
   * Returns null when the row is missing. The caller treats that as revoked:
   * a claim pointing at a row that no longer exists must not authorize
   * anything.
   */
  async getToken(tokenId: string): Promise<any | null> {
    if (!tokenId) return null
    const rows = await this.listMcpOauthTokens({ id: tokenId })
    return rows?.[0] ?? null
  }

  /** Every authorization for one admin — powers the settings listing. */
  async listTokensForUser(userId: string): Promise<any[]> {
    if (!userId) return []
    return (
      (await this.listMcpOauthTokens(
        { user_id: userId },
        { order: { created_at: "DESC" } }
      )) ?? []
    )
  }

  /**
   * Mark a token revoked. Idempotent — revoking twice is a no-op rather than
   * an error, because a client that retries `POST /oauth/revoke` after a
   * timeout is doing the right thing (RFC 7009 requires a 200 either way).
   */
  async revokeToken(tokenId: string): Promise<void> {
    const existing = await this.getToken(tokenId)
    if (!existing || existing.revoked_at) return
    await this.updateMcpOauthTokens([
      {
        id: tokenId,
        revoked_at: new Date(),
        // Drop the refresh secret at the same moment. Leaving it would let a
        // holder keep exchanging it and only discover the revocation on the
        // access-token check — one avoidable round trip through a valid-looking
        // credential.
        refresh_token_hash: null,
      },
    ])
  }
}

export default McpOauthService
