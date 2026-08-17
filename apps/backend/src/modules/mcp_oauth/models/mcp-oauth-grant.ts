import { model } from "@medusajs/framework/utils"

/**
 * A pending authorization code (#1306 Track B).
 *
 * Written when an admin approves a consent screen, consumed once at
 * `POST /oauth/token`. Short-lived by design — the code travels through a
 * browser redirect, which is the least trustworthy leg of the flow.
 *
 * Only `code_hash` is stored. A leaked database row must not be redeemable, so
 * the code itself exists solely in the redirect and in the client's memory —
 * the same reasoning as `mcp_oauth_token.refresh_token_hash`.
 *
 * `consumed_at` rather than a delete: a second redemption of the same code is
 * evidence the code leaked, and the row has to survive for us to notice. The
 * token endpoint revokes every token already issued from a replayed code.
 */
const McpOauthGrant = model
  .define("mcp_oauth_grant", {
    id: model.id({ prefix: "mcpg" }).primaryKey(),

    // sha256 of the authorization code.
    code_hash: model.text().searchable(),

    client_id: model.text().searchable(),

    // Must match the `redirect_uri` presented at the token endpoint verbatim.
    redirect_uri: model.text(),

    // PKCE (RFC 7636). `plain` is rejected at the authorize endpoint, so this
    // is always S256 in practice — stored anyway so a stored row is
    // self-describing rather than depending on today's validation.
    code_challenge: model.text(),
    code_challenge_method: model.text().default("S256"),

    // The admin who approved. Becomes `actor_id` on the minted token, so every
    // action taken through this grant attributes to a real user.
    user_id: model.text(),

    // Their auth identity — the framework's authenticate middleware expects it
    // on the JWT payload.
    auth_identity_id: model.text().nullable(),

    // The MCP scope ladder rung the admin approved: read|write|sensitive|dangerous.
    level: model.text().default("read"),

    // Echoed back on the redirect for the client's CSRF check.
    state: model.text().nullable(),

    expires_at: model.dateTime(),
    consumed_at: model.dateTime().nullable(),

    metadata: model.json().nullable(),
  })
  .indexes([
    {
      on: ["code_hash"],
      unique: true,
    },
  ])

export default McpOauthGrant
