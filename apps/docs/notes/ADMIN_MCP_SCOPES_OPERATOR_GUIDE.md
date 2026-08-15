# Admin MCP scopes — operator guide

How to hand someone a restricted credential, and how to prove the restriction is
real. The design rationale lives in [`ADMIN_MCP_SCOPES.md`](./ADMIN_MCP_SCOPES.md);
this is the doing.

Everything below was measured against **prod** on 2026-08-15, on `main` @
`583bc44c7` (deploy run `31881352146`).

---

## 1. The one-paragraph model

Two env flags (`ADMIN_MCP_ENABLE_WRITE`, `ADMIN_MCP_ENABLE_DANGEROUS`) set a
process-wide **ceiling**. A row in `mcp_access_scope` narrows **one** credential
below that ceiling. Effective level is `min(ceiling, row)`, and **no row means
the ceiling** — so scopes are opt-in, and *removing* a row widens a credential
rather than revoking it.

Ladder: `read → write → sensitive → dangerous`.

---

## 2. Do it in the UI

**Settings → MCP Access Scopes.**

- The header shows the current **ceiling** and how many tools each level exposes.
- **Scope a credential** → pick a secret API key from the list, choose a level,
  save.
- **Edit** changes the level of an existing row; **Remove** widens it back to the
  ceiling (the confirm dialog says so, because "remove" reads like "revoke" and
  it is not).

The credential picker lists secret API keys by ID on purpose — see the
`principal_id` trap in §5.

## 3. Or do it over HTTP

```
GET    /admin/mcp/scopes        # rows + ceiling + tool count per level
POST   /admin/mcp/scopes        # upsert { principal_type, principal_id, level, label?, note? }
DELETE /admin/mcp/scopes/:id    # stop restricting (widens to the ceiling)
```

```jsonc
POST /admin/mcp/scopes
{ "principal_type": "api-key", "principal_id": "apk_…", "level": "read",
  "label": "claude-code-mcp", "note": "read-only until Track B lands" }
```

---

## 4. ⚠️ Only a signed-in admin USER can manage scopes

All three routes refuse anything that is not `actor_type: "user"`. **A secret API
key can never write a scope row**, no matter which mount or header you use — a
machine credential widening its own scope would defeat the whole mechanism.

This costs people real time, so here is the proof it is the credential *class*
and not a misconfiguration. The same `sk_…` token:

| Sent as | Route | Result |
|---|---|---|
| `Basic` (`-u "$TOKEN:"`) | `/admin/mcp` | 200 |
| `Basic` | `/admin/mcp/scopes` (GET **and** POST) | **403** |
| `Bearer` | `/admin/mcp/scopes` | **401** |

401-as-Bearer plus 200-as-Basic means it is a secret key, not a JWT, so Medusa
stamps `actor_type: "api-key"` and the guard rejects it. Get a real session
instead:

```bash
# 1. log in as a human admin → {"token": "<jwt>"}
curl -s -X POST https://v3.jaalyantra.com/auth/user/emailpass \
  -H "Content-Type: application/json" -d @login.json > ptok.json

# 2. turn it into a curl config (avoids inline secret substitution)
sed -e 's/{"token":"/header = "Authorization: Bearer /' -e 's/"}[[:space:]]*$/"/' \
  ptok.json > pjwtrc

# 3. use it
curl -s -K pjwtrc https://v3.jaalyantra.com/admin/mcp/scopes
```

`GET /admin/mcp/scopes` as a human admin is also the **cheapest check that the
migration landed** — it reads `mcp_access_scope` directly, so a 200 settles it.

---

## 5. ⚠️ `principal_id` is the key ID, not the token

For a Medusa secret key it is the `apk_…` **key ID**, because that is what
Medusa puts in `auth_context.actor_id`. A row keyed on the token is not an
error — it simply never matches, and the credential silently keeps running at
the ceiling. The UI picker exists to remove this failure mode.

---

## 6. Verify it actually bites

Do not stop at "the row saved". Two probes, and **run them against a second,
unscoped credential at the same time** — that control is what shows the row is
per-credential rather than a global flag flip:

```bash
# A. tool surface
curl -s -K <cred>rc -X POST https://v3.jaalyantra.com/admin/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | jq '.result.tools|length'

# B. HTTP guard — empty body, writes nothing either way
curl -s -o /dev/null -w "%{http_code}\n" -K <cred>rc \
  -X POST https://v3.jaalyantra.com/admin/products \
  -H "Content-Type: application/json" -d '{}'
```

Measured on prod, with `ceiling = dangerous`:

| | scoped to `read` | unscoped |
|---|---|---|
| `tools/list` | **54** | 123 |
| `POST /admin/products {}` | **403** | **400** |

🔑 **The 403-vs-400 pair is the whole proof.** `400` means the guard did *not*
fire and the empty body was merely rejected by validation; `403` means it did.
Neither writes anything, which is what makes this safe to run against prod.

---

## 7. Gotchas learned the hard way

- **`write` grants nothing today.** Measured: `read 54 · write 54 ·
  sensitive 117 · dangerous 123`. Every admin write tool is flagged sensitive,
  so a credential scoped to `write` reaches **exactly** what `read` reaches, and
  anything that mutates needs `sensitive`. This is why the UI prints a tool count
  next to every level: the ladder alone makes `write` look useful.
- **Removing a row widens.** It is "stop restricting", not "block". To take
  access away, revoke the API key in Medusa, or set the row to `read`.
- **A row above the ceiling is stored but clamped.** The API returns a `warning`
  and the UI surfaces it as a warning toast rather than a success — otherwise the
  credential looks like it is at a level it is not.
- **Scoping a credential restricts it everywhere, not just MCP.** The HTTP guard
  covers all of `/admin/*` for machine principals, because a secret key
  authenticates every admin route — scoping only the tool list would be theatre.
  So check what else uses a key before scoping it.
- **A missing `mcp_access_scope` table 500s the whole MCP surface**, and only for
  requests where a principal resolves. `loadMcpScopeLevel` catches a missing
  *module* but not a failing *query*.

---

## 8. What is NOT covered

**Partner MCP has no scopes.** `/partners/mcp` is gated only by the process-wide
`PARTNER_MCP_ENABLE_WRITE` flag — there is no per-credential ladder, no
`mcp_access_scope` equivalent, and no partner secret-key model at all
(`/partners/api-keys` is publishable-only). Partners authenticate with session or
bearer partner JWTs. Giving partners their own scoped MCP credentials is
unstarted work, not a configuration step.
