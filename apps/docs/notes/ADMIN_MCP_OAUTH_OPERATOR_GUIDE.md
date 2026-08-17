# Admin MCP over OAuth — operator guide

How to let Claude, ChatGPT or Cursor drive the Admin MCP as you, and how to take
that away again. The per-credential restriction model lives in
[`ADMIN_MCP_SCOPES_OPERATOR_GUIDE.md`](./ADMIN_MCP_SCOPES_OPERATOR_GUIDE.md);
this is the front door in front of it.

Everything marked ✅ below was measured against **prod** on 2026-08-17, on `main`
@ `cddd8b7ad` (deploy run `31999774055`). Numbers marked ⚠️ are **local**
measurements that have not been reproduced on prod — they are flagged rather
than quietly presented as facts.

---

## 1. The one-paragraph model

An external client is pointed at **one URL** and discovers everything else
itself. It registers, sends you to a consent screen, you sign in with your
normal admin password and **choose how much it gets**, and it receives a token.

That token **is a Medusa `user` JWT** carrying an `mcp_oauth` claim. There is no
`actor_type: "oauth"` — the framework 401s every actor type but `user` on
`/admin/*`, so no other shape was available. Two consequences follow, and both
matter more than the mechanism:

- **The client acts as you.** Every action it takes is attributed to your user
  id, in audit trails and everywhere else. "Who did this?" answers with your
  name, not the client's.
- **It is as powerful as a dashboard session** on any route the per-tier guard
  does not cover. Same posture as a secret API key. Deliberate, and unavoidable
  given the above.

---

## 2. Connect a client

Give it this, and nothing else:

```
https://v3.jaalyantra.com/mcp/admin
```

✅ The client fetches `/.well-known/oauth-protected-resource`, follows it to the
authorization server, registers itself, and opens the consent screen in a
browser. Nothing has to be created in advance — no key, no client, no config.

**On the consent screen** you sign in with your admin password and pick a level.
The tool count for each level is shown next to it, because the honest answer to
"how much am I giving away?" is a number, not an adjective.

The selection defaults to the **narrowest** of {what the client asked for, the
ceiling}, falling back to `read` when the client asked for nothing — the default
a tired admin accepts at 1am should be the least powerful one that works.

### The URL is the only input

`/mcp/admin` is not guessable and lives nowhere a human would naturally look. It
is printed with a copy button at the top of **Settings → MCP OAuth
Authorizations** so it is never something you have to remember.

⚠️ **It is `/mcp/admin`, NOT `/admin/mcp`.** They are different endpoints:

| | |
|---|---|
| `/mcp/admin` | the **OAuth** mount — this guide |
| `/admin/mcp` | the **secret API key** mount — unchanged, still works |

The split is not cosmetic. Anything under `/admin/*` is 401'd by the framework
before our code runs, and that 401 **cannot carry a `WWW-Authenticate` header** —
which is precisely the header an MCP client needs in order to discover where to
authenticate. One curl settled it:

```
POST /mcp/admin  → 401  www-authenticate: Bearer … resource_metadata="…"   ✅
POST /admin/mcp  → 401  {"message":"Unauthorized"}    ← no header, and none can be added
```

---

## 3. See what is connected

**Settings → MCP OAuth Authorizations.**

Each row shows the client, **the admin it acts as** (by name, not `usr_…`), its
level, when it was authorized and when it was last used.

### Four states, and one of them is a trap

| State | What it means |
|---|---|
| **Active** | Working now. |
| **Access expired · will refresh** | ⚠️ **Still live.** |
| **Expired** | The refresh token lapsed too. Genuinely dead. |
| **Revoked** | Switched off. |

The second row is the one to read carefully. A client whose *access* token has
expired **is not locked out** — it still holds a refresh token and will mint a
new access token without anyone approving anything. Left alone, it keeps
working indefinitely. The screen says so in the row rather than behind a
tooltip, because "expired" is exactly the word that would persuade you to leave
a live authorization in place.

**If you want it to stop, revoke it. Expiry will not do it for you.**

---

## 4. Revoke

Press **Revoke**. That is the whole procedure, and it takes effect on the
client's **very next request, reads included**.

Over HTTP, if you prefer:

```
GET    /admin/mcp/oauth-tokens        # every authorization ever issued
DELETE /admin/mcp/oauth-tokens/:id    # revoke one
```

Revocation is immediate despite the access token being a self-verifying JWT,
because the `/admin/*` global in `src/api/middlewares.ts` reads the token row on
every request that carries an `mcp_oauth` claim. That read is what makes the
difference between "revoked" and "revoked once it expires".

**The client is not notified.** It simply starts receiving 401s. Most clients
will then try to re-authorize, which is the intended behaviour — the person has
to consent again from scratch.

### Why revoking narrows the scope row instead of deleting it

On revoke, the credential's row in `mcp_access_scope` is set to `read` rather
than removed. This looks like leftover state and is not:

> **No row means the process ceiling, not zero.** Deleting the row while any
> path still accepted the token would *widen* the credential at the exact moment
> it was meant to lose access.

Failing safe costs one stale row. Failing the other way costs a live credential
at full ceiling. Same trap as `DELETE /admin/mcp/scopes/:id`, which widens
rather than revokes.

### ⚠️ Only a signed-in admin USER can list or revoke

Both routes refuse anything that is not `actor_type: "user"` — a machine
credential must not be able to enumerate its siblings, and emphatically must not
be able to see whether it is itself about to be revoked. They are deliberately
**not exposed as MCP tools**.

✅ Verified on prod 2026-08-17 with a secret API key:

```
GET /admin/mcp/scopes
→ "MCP scopes can only be managed by a signed-in admin user.
   A machine credential cannot read or change its own scope."
```

This is also why the tool counts in §6 are still marked local-only: measuring
them on prod requires a signed-in admin, and a secret key cannot do it.

---

## 5. Narrow one further

An authorization is a principal like any other, so
[the scopes model](./ADMIN_MCP_SCOPES_OPERATOR_GUIDE.md) applies unchanged:

```jsonc
POST /admin/mcp/scopes
{ "principal_type": "oauth", "principal_id": "mcpt_…", "level": "read" }
```

`principal_id` is the **authorization id** (`mcpt_…`) shown on the row, not the
client id and not the token. The restriction binds to the **token**, not to the
person — so the same admin can hold a `read` authorization for one client and a
`sensitive` one for another.

Effective level stays `min(ceiling, row)`.

---

## 6. What each level reaches

⚠️ **Local measurements, not reproduced on prod** (see §4 for why):

| Level | Tools | Notes |
|---|---|---|
| `read` | 54 | Reads only. |
| `write` | 63 | Writes that are not flagged sensitive. |
| `sensitive` | 117 | Reads plus writes. |
| `dangerous` | 123 | Everything, including platform-destructive tools. |

The `write` rung was measured through the OAuth path specifically: a
`write`-scoped credential reaches 63 tools **and is still 403'd** on
`POST …/shipping-label`, which is the check that proves the tier guard covers
direct HTTP routes and not just the MCP tool list.

Before #1310 split the `tier` axis out, `write` and `read` were the same 54 —
`sensitive` was answering two different questions at once (confirm-UX *and*
permission).

---

## 7. Discovery endpoints

✅ All verified on prod 2026-08-17.

```
GET /.well-known/oauth-protected-resource
    → resource: https://v3.jaalyantra.com/mcp/admin
      scopes_supported: mcp:read mcp:write mcp:sensitive mcp:dangerous

GET /.well-known/oauth-authorization-server
    → issuer / authorization_endpoint / token_endpoint
      registration_endpoint / revocation_endpoint
      code_challenge_methods_supported: ["S256"]
```

Plus: dynamic client registration, refresh with rotation, and RFC 7009
revocation at `/oauth/revoke`.

**`plain` PKCE is rejected outright** — `code_challenge_method` must be `S256`.

---

## 8. Troubleshooting

**The client says it cannot find the authorization server.**
Check the issuer scheme in `/.well-known/oauth-protected-resource`. An `http://`
issuer is rejected by conforming clients. ✅ On prod it returns `https` — the
`x-forwarded-proto` handling works behind the ALB. If that ever changes, set
`MCP_OAUTH_ISSUER`, and **tag the SSM parameter** with
`copilot-application=jyt` and `copilot-environment=prod` or the deploy silently
ships nothing.

**Everything 404s, including routes you know exist.**
Check what you are actually talking to before theorising. A dev server from an
earlier session holding port 9000 will answer every request from code that does
not contain the feature. The tell is that a plain *file* route 404s too, which
no theory about dot-directories explains.

**The OAuth routes 500.**
The `mcp_oauth` tables are missing. ✅ They migrated on prod — proven by
`POST /oauth/register` writing a row, which is a better check than reading the
migrate log for `MODULE: mcp_oauth`, because **discovery documents answer
without touching the database**. A 200 on `/.well-known/*` proves routing only.

**A revoked client still works.**
It should not, on the next request. If it does, the `/admin/*` revocation global
is not seeing the row — that read is the entire enforcement mechanism.

---

## 9. What would still fool you

- **A `tools/list` that succeeds proves nothing about tool *calls*.** This
  exact mistake was made once already on the secret-key path: `tools/list`
  worked while every dispatch 401'd, and two succeeding calls looked like
  confirmation. Exercise an actual tool.
- **"Access expired" is not "stopped".** See §3.
- **Removing a scope row widens, it does not revoke.** See §4.
- **The tool counts in §6 have never run on prod.** They are the numbers from a
  local server. Treat them as the shape of the ladder, not as an inventory.
