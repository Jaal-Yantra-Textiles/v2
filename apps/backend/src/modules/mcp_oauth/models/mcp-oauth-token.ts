import { model } from "@medusajs/framework/utils"

/**
 * One issued authorization — the identity a third-party client acts under
 * (#1306 Track B).
 *
 * The access token itself is NOT stored: it is a Medusa user JWT carrying an
 * `mcp_oauth: { token_id }` claim, verified statelessly by the framework. This
 * row is what that claim points at, and it exists for the two things a JWT
 * cannot do on its own — be revoked, and carry a scope.
 *
 * 🔑 **The row survives refresh.** Rotating the refresh token updates
 * `refresh_token_hash` in place and keeps `id`, so the `mcp_access_scope` row
 * written against `("oauth", <id>)` at issuance stays attached for the life of
 * the authorization. Scope binds to the AUTHORIZATION, not to one access token
 * — otherwise every refresh would silently restore the process ceiling.
 *
 * ⚠️ An access token minted here is a real admin user JWT. On any route the
 * per-route scope guard does not cover it is as powerful as a dashboard
 * session — the same posture as a Medusa secret API key. That is a deliberate
 * consequence of the framework rejecting every non-`user` actor type on
 * `/admin/*`; do not widen it further.
 */
const McpOauthToken = model
  .define("mcp_oauth_token", {
    // `mcpt_…`. This is the value carried in the JWT's `mcp_oauth.token_id`
    // claim and the `principal_id` of the credential's scope row.
    id: model.id({ prefix: "mcpt" }).primaryKey(),

    client_id: model.text().searchable(),

    // The admin this authorization acts as.
    user_id: model.text().searchable(),
    auth_identity_id: model.text().nullable(),

    // The approved rung, duplicated from the scope row purely for display and
    // audit. The row in `mcp_access_scope` is what is ENFORCED — one source of
    // truth for permissions, and it is the one Track C already reads.
    level: model.text().default("read"),

    // sha256 of the current refresh token. Null once refresh is exhausted or
    // the client never received one.
    refresh_token_hash: model.text().nullable(),

    // When the most recently minted access token stops verifying. Informational
    // — expiry is enforced by the JWT's own `exp`, not by this column.
    access_expires_at: model.dateTime().nullable(),

    refresh_expires_at: model.dateTime().nullable(),

    // Set by the revocation endpoint or an admin. Checked on EVERY request,
    // reads included: a revoked token must not read either.
    revoked_at: model.dateTime().nullable(),

    last_used_at: model.dateTime().nullable(),

    metadata: model.json().nullable(),
  })
  .indexes([
    {
      on: ["refresh_token_hash"],
      unique: true,
      where: "refresh_token_hash IS NOT NULL AND deleted_at IS NULL",
    },
    {
      on: ["user_id"],
    },
  ])

export default McpOauthToken
