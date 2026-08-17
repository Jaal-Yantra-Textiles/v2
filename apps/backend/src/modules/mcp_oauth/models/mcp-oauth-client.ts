import { model } from "@medusajs/framework/utils"

/**
 * A dynamically-registered OAuth client (#1306 Track B, RFC 7591).
 *
 * Claude web/desktop, ChatGPT and Cursor cannot hold a static secret, so they
 * register themselves at connect time and then run authorization-code + PKCE.
 * Registration by itself grants NOTHING: a row here is only a name and a set of
 * redirect URIs. Every capability comes from a token, and no token exists until
 * a human admin has logged in and approved one.
 *
 * `client_secret_hash` is nullable because public clients (the ones this exists
 * for) have no secret — PKCE is what binds the code to the client. When a
 * confidential client does register, only the hash is stored; the secret is
 * shown once at registration and never again, matching how Medusa treats its
 * own secret API keys.
 */
const McpOauthClient = model
  .define("mcp_oauth_client", {
    id: model.id({ prefix: "mcpcl" }).primaryKey(),

    // The public `client_id` handed to the client. Distinct from `id` so the
    // value a third party holds is never a database primary key.
    client_id: model.text().searchable(),

    // sha256 of the client secret, or null for a public (PKCE-only) client.
    client_secret_hash: model.text().nullable(),

    // RFC 7591 `client_name` — shown to the admin on the consent screen. This
    // is attacker-controlled text; render it escaped.
    client_name: model.text(),

    // Exact-match redirect URIs. An authorization request must name one of
    // these verbatim — no prefix or wildcard matching, which is the classic
    // open-redirect hole in OAuth implementations.
    redirect_uris: model.json(),

    // `client_credentials` is deliberately absent: this front door exists to
    // act as a human admin, so there is no grant that skips the human.
    grant_types: model.json().nullable(),

    // "none" for public clients, "client_secret_post"/"client_secret_basic"
    // otherwise.
    token_endpoint_auth_method: model.text().default("none"),

    // The scope string the client asked for at registration, kept for display.
    // It is NOT authority — the admin chooses the level at consent time.
    scope: model.text().nullable(),

    metadata: model.json().nullable(),
  })
  .indexes([
    {
      on: ["client_id"],
      unique: true,
    },
  ])

export default McpOauthClient
