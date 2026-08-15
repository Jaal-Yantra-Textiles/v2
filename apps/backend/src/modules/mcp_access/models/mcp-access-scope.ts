import { model } from "@medusajs/framework/utils"

/**
 * Per-token MCP access scope (#1306 Track C).
 *
 * `ADMIN_MCP_ENABLE_WRITE` / `ADMIN_MCP_ENABLE_DANGEROUS` are process-wide env
 * flags, so before this model every credential that could reach `/admin/mcp`
 * inherited whatever the process allowed — there was no read-only token. This
 * table narrows a SINGLE principal below that ceiling.
 *
 * One row per (principal_type, principal_id). Absent a row the principal gets
 * the process ceiling, i.e. today's behaviour — adding this model changes
 * nothing until someone writes a row.
 *
 * `principal_type` mirrors Medusa's `auth_context.actor_type`:
 *   - "api-key" — a Medusa secret API key (`apk_…` is the `principal_id`).
 *     This is what a machine/MCP client authenticates with today.
 *   - "user"    — a human admin. Rows are accepted but NOT enforced on plain
 *     HTTP routes (see the guard in `src/api/middlewares.ts`): a human can
 *     always use the dashboard, so an HTTP-level restriction there would be
 *     theatre. They still apply to the MCP tool surface.
 *   - "oauth"   — reserved for Track B's minted tokens.
 *
 * `level` is a LADDER, not a set of independent switches, so no nonsensical
 * combination (dangerous-but-not-write) can be stored:
 *
 *   read      → GET tools only. The read-only token that did not exist before.
 *   write     → ordinary mutations; `sensitive`/`dangerous` tools stay hidden.
 *   sensitive → adds the confirm-gated tools (every DELETE is implicitly one).
 *   dangerous → adds the platform-destructive tools (confirm + human reason).
 *
 * The effective level is always `min(process ceiling, this row)` — a row can
 * only ever restrict. Widening still requires the env flag, so a compromised
 * scope row cannot turn a read-only deployment into a write one.
 */
const McpAccessScope = model
  .define("mcp_access_scope", {
    id: model.id().primaryKey(),

    // Medusa auth_context.actor_type — see the doc-comment.
    principal_type: model.text().searchable(),

    // The API key id (`apk_…`), admin user id, or OAuth token id.
    principal_id: model.text().searchable(),

    // read | write | sensitive | dangerous. Stored as text rather than an enum
    // so Track B can add a level without a column migration.
    level: model.text().default("read"),

    // Human label for the credential this scopes, e.g. "claude-code-mcp".
    // Free-text: the api_key title lives in another module and can drift.
    label: model.text().nullable(),

    // Why this principal is restricted — shown in the scope listing.
    note: model.text().nullable(),

    metadata: model.json().nullable(),
  })
  .indexes([
    {
      on: ["principal_type", "principal_id"],
      unique: true,
    },
  ])

export default McpAccessScope
