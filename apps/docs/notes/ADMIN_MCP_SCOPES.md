# Admin MCP — per-credential scopes (#1306 Track C)

## What this replaces

`ADMIN_MCP_ENABLE_WRITE` (default **true**) and `ADMIN_MCP_ENABLE_DANGEROUS`
(default false) are **process-wide** env flags. Every credential that could
reach `POST /admin/mcp` inherited whatever the process allowed, so **there was
no read-only token** — which is what blocked opening the MCP endpoint to a
third-party client.

Those flags now set a **ceiling**. A row in `mcp_access_scope` narrows a single
credential below it. The effective level is always `min(ceiling, row)`, so a row
can only ever restrict; widening still requires the env flag.

**Absent a row, a credential gets the ceiling** — i.e. exactly the behaviour
that existed before. Nothing changes until someone writes a row.

## The ladder

| Level | Grants |
|---|---|
| `read` | GET tools only |
| `write` | + ordinary mutations |
| `sensitive` | + confirm-gated tools (every DELETE is implicitly one) |
| `dangerous` | + platform-destructive tools (confirm **and** a human reason) |

The default deployment (writes on, dangerous off) has a ceiling of
**`sensitive`**, not `write` — confirm-gated tools have always been callable
when writes are on, and the ceiling has to preserve that.

> ⚠️ **`write` currently grants nothing beyond `read`.** Of the 69 write tools in
> the admin registry, 59 are flagged `sensitive: true` and the other 10 are
> DELETEs (implicitly sensitive). So a credential that needs to change anything
> needs **`sensitive`**. `GET /admin/mcp/scopes` reports the tool count per level
> so this is visible at the moment of choosing one, and
> `scope-invariants.unit.spec.ts` pins it — when a genuinely non-sensitive write
> tool lands, that test fails and the `write` rung starts meaning something.

## Two enforcement points, and why both are needed

1. **The MCP tool surface** (`api/admin/mcp/lib/handler.ts` → `mcp-core`) filters
   `tools/list` and refuses at dispatch.
2. **The HTTP layer** (`enforceMcpScopeOnAdminWrites` in `src/api/middlewares.ts`)
   refuses non-GET `/admin/*` requests from a `read`-scoped machine credential.

Without (2) the scope would be **theatre**: a Medusa secret API key
authenticates every admin route, so a read-only token could simply POST the
wrapped route directly. And because the MCP dispatcher reaches routes over the
same loopback HTTP path, (2) also backstops (1).

**Machine principals only.** The HTTP guard applies to `actor_type` `api-key`
(and, later, `oauth`). A human admin holds a dashboard session and can do
anything through the UI, so refusing their raw HTTP writes would restrict
nothing while risking locking a real person out. A `user` row still narrows the
MCP tool surface and the in-app assistant.

### Exempt paths

`MCP_SCOPE_EXEMPT_ADMIN_PATHS` (`src/lib/mcp-scope.ts`) — non-GET paths a
read-scoped credential may still call, because they are POSTs that only read:

- `/admin/mcp` — the JSON-RPC transport. **Every** tool call is a POST, reads
  included; scope is enforced per-tool inside the dispatcher instead.
- `/admin/mcp/resolve-query` — `resolve_admin_query`, a planner.
- `/admin/assistant/vision` — `read_image`, POST only because the reference goes
  in the body.

An invariant test asserts every non-GET tool that isn't flagged `write` is
listed here, so a future read-only POST tool fails the suite instead of silently
403ing for read-only credentials.

## Managing scopes

```
GET    /admin/mcp/scopes        # list + ceiling + tool count per level
POST   /admin/mcp/scopes        # upsert { principal_type, principal_id, level, label?, note? }
DELETE /admin/mcp/scopes/:id    # stop restricting (widens back to the ceiling)
```

**Human admins only** — all three refuse any principal that is not
`actor_type: "user"`. A machine credential must never be able to widen its own
scope; without that check a `write` token could POST itself up to `dangerous`.

For the same reason these are **deliberately not wrapped as MCP tools**: the tool
surface is driven by a model, and scope escalation is not something a model
should be able to attempt.

Scoping the key minted for `claude-code-mcp`:

```jsonc
POST /admin/mcp/scopes
{ "principal_type": "api-key", "principal_id": "apk_…", "level": "read",
  "label": "claude-code-mcp", "note": "read-only until Track B lands" }
```

`principal_id` for a Medusa secret key is the **key id** (`apk_…`), not the
token — Medusa sets `auth_context.actor_id` to the key id.

Deleting a row **widens**; it does not revoke. To take access away, revoke the
API key in Medusa (or set the row to `read`).

## Notes for Track B (OAuth)

Minted tokens should carry `principal_type: "oauth"` and get an explicit row at
issue time rather than relying on the ceiling default. `"oauth"` is already in
`MCP_MACHINE_PRINCIPAL_TYPES`, so the HTTP guard covers it the moment
`auth_context.actor_type` says so.
