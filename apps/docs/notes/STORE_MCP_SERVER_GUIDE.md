# Store MCP Server — Architecture & Authoring Guide

The Store MCP server exposes the Medusa **Store API** to AI agents (Claude Code,
Cursor, Claude Desktop, internal Mastra agents) over the
[Model Context Protocol](https://modelcontextprotocol.io). It started read-only
(catalog browsing) and now also offers a **gated write path** for the full
cart → checkout → pay flow.

> Source: `apps/backend/src/api/mcp/`. Connection snippets live in
> `apps/backend/src/api/mcp/README.md` (kept short, operator-facing). This doc is
> the deeper "how it works / how to extend it" reference.

---

## 1. Design in one paragraph

The MCP server is a **thin loopback proxy in front of a declarative registry**.
Each MCP tool maps to exactly one live `/store/*` route. When a tool is called,
the server forwards the arguments to that route over HTTP **on the same process**
(`proxy.ts`), attaching a resolved publishable key. Because the call goes through
the real route, every tool inherits Medusa's publishable-key/sales-channel
scoping, pricing & tax context, request validators, and our custom route
overrides — for free. **Adding a new tool is one row in `registry.ts`.**

```
agent ──JSON-RPC──▶ POST /mcp ──▶ handler.ts ──▶ server.ts (tools/list, tools/call)
                                                     │
                          native tool? ──────────────┤── store-resolver.ts (query.graph)
                          proxy tool?  ───────────────┘── proxy.ts ──HTTP loopback──▶ /store/* route
```

---

## 2. The five locked architecture decisions

These are deliberate; don't "simplify" them away.

1. **Loopback proxy + declarative registry, not re-querying.**
   Tools forward to the live `/store/*` route rather than re-implementing the
   query against `query.graph`. That's what makes every tool inherit pricing,
   tax, scoping, validators, and custom overrides (e.g. our `/store/products`
   index-engine bugfix). One registry row = one new tool. See `proxy.ts` and
   `registry.ts`.

2. **Dual mount.** The whole `/store` namespace is hard-gated by Medusa's
   `ensurePublishableApiKeyMiddleware`, so we expose **two** entry points that
   share one handler:
   - `POST /mcp` — **open / zero-config.** Outside `/store`, so no key required
     to connect. The handler injects a key per call (see §3).
   - `POST /store/mcp` — **gated.** Inside `/store`, so a caller must always send
     `x-publishable-api-key`. Good for clients pinned to one storefront.

3. **Hybrid key resolution.** A tool's effective publishable key is chosen per
   call with this precedence:
   `store` argument → `x-publishable-api-key` header → `STORE_MCP_DEFAULT_PUBLISHABLE_KEY` env.
   Publishable keys are **public** storefront keys (shipped as
   `NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY`), so resolving/returning them leaks
   nothing. If none resolve, the tool returns an **in-band error** explaining how
   to scope the request — it never HTTP-500s.

4. **Multi-tenant store resolution.** The platform runs many partner
   storefronts (each = one sales channel = one publishable key) **plus its own
   core store** (the apex `cicilabel.com`). Agents work in terms of **store
   names**, not raw `pk_` tokens. Native (container-backed) tools `list_stores`
   and `get_storefront_key` resolve partner handle/domain → store → default
   sales channel → publishable token via `store-resolver.ts` (mirrors
   `GET /web/storefront/[subdomain]`). Any proxy tool also accepts an optional
   `store` arg that resolves the same way.
   - **The core store is not partner-owned**, so iterating partners alone misses
     it. `store-resolver.ts` therefore also queries the `stores` entity and
     includes any store **not** linked to a partner, flagged `is_default: true`
     and given the apex domain (`ROOT_DOMAIN`, default `cicilabel.com`). It is
     resolvable by `"default"` / `"main"`, the apex domain, or its store
     name/id/sales-channel id. `list_stores` returns default store(s) first.

5. **Stateless Streamable-HTTP transport.** Each POST is a self-contained
   JSON-RPC request (`sessionIdGenerator: undefined`, `enableJsonResponse: true`).
   The low-level `Server` doesn't enforce initialize-first, so single-shot
   `tools/list` / `tools/call` work with no session. `GET`/`DELETE` on the mount
   return 405.

---

## 3. File layout

```
src/api/mcp/
├── route.ts              POST /mcp        (open mount)
└── lib/
    ├── handler.ts        transport wiring + key resolution + write toggle
    ├── server.ts         tools/list + tools/call dispatch (proxy vs native, gating)
    ├── registry.ts       declarative tool -> endpoint table (read + write)
    ├── proxy.ts          loopback fetch to /store/* (GET + write body)
    └── store-resolver.ts native store discovery / key resolution
src/api/store/mcp/route.ts  POST /store/mcp (gated mount; delegates to the same handler)
```

---

## 4. Tool kinds

| Kind | Set on the def | Runs via | Examples |
|------|----------------|----------|----------|
| **Proxy (read)** | `method: "GET"` + `path` | `proxy.ts` loopback | `list_products`, `get_product`, `semantic_search` |
| **Proxy (write)** | `method: "POST"/"DELETE"` + `bodyParams` + `write: true` | `proxy.ts` loopback | `create_cart`, `add_line_item`, `complete_cart` |
| **Native** | `native: "..."` | `store-resolver.ts` in-process | `list_stores`, `get_storefront_key` |

`tools/list` and `tools/call` live in `server.ts`. Path params (`:id`) are
substituted from args; whitelisted `queryParams` become the query string;
whitelisted `bodyParams` become the JSON body. The `store` arg is consumed for
key resolution and **never** forwarded to the route.

---

## 5. Adding a **read** tool (the 1-row case)

Add an entry to `STORE_MCP_TOOLS` in `registry.ts`. Use the `listTool` /
`getTool` builders for sales-channel list and retrieve-by-id endpoints:

```ts
listTool(
  "list_return_reasons",
  "List the store's return reasons.",
  "/store/return-reasons"
)
getTool("get_region", "Retrieve a region by id.", "/store/regions/:id")
```

That's it — no other code changes. The builders attach the standard `fields`,
`store`, and pagination props, and a `q` prop when `searchable: true`.

---

## 6. Adding a **write** tool (cart / checkout / pay)

Write tools are proxy tools with `write: true`. They are **hidden from
`tools/list` and rejected by `tools/call` unless `STORE_MCP_ENABLE_WRITE` is
truthy** (`true` / `1` / `yes`). The toggle is read once per request in
`handler.ts:isWriteEnabled()` and threaded through `StoreMcpContext.enableWrite`.

Shape of a write def:

```ts
{
  name: "add_line_item",
  description: "Add a product variant to a cart. Returns the updated cart.",
  write: true,                                  // gated
  method: "POST",                               // or "DELETE"
  path: "/store/carts/:id/line-items",
  pathParams: ["id"],                           // :id <- args.id
  bodyParams: ["variant_id", "quantity", "metadata"],  // -> JSON body
  inputSchema: { /* JSON Schema, kept loose */ },
}
```

**Why the schema stays loose:** the store route runs its own
`validateAndTransformBody` validator, which is the real source of truth. The
MCP-side `inputSchema` only needs to guide the agent and mark required fields;
let Medusa reject malformed bodies with its precise errors.

### The full checkout flow (the write tools today)

```
create_cart ──▶ add_line_item* ──▶ update_cart (email + shipping/billing address)
   ──▶ list_shipping_options ──▶ add_shipping_method
   ──▶ list_payment_providers ──▶ create_payment_collection
   ──▶ initialize_payment_session ──▶ complete_cart  ⇒  { type: "order", order }
```

| Tool | Method | Route |
|------|--------|-------|
| `create_cart` | POST | `/store/carts` |
| `get_cart` | GET | `/store/carts/:id` |
| `update_cart` | POST | `/store/carts/:id` |
| `add_line_item` | POST | `/store/carts/:id/line-items` |
| `update_line_item` | POST | `/store/carts/:id/line-items/:line_id` |
| `remove_line_item` | DELETE | `/store/carts/:id/line-items/:line_id` |
| `add_promotion` | POST | `/store/carts/:id/promotions` |
| `list_shipping_options` | GET | `/store/shipping-options?cart_id=` |
| `add_shipping_method` | POST | `/store/carts/:id/shipping-methods` |
| `list_payment_providers` | GET | `/store/payment-providers?region_id=` |
| `create_payment_collection` | POST | `/store/payment-collections` |
| `initialize_payment_session` | POST | `/store/payment-collections/:id/payment-sessions` |
| `complete_cart` | POST | `/store/carts/:id/complete` |

`complete_cart` returns `{ type: "order", order }` on success or
`{ type: "cart", cart, error }` if completion failed (e.g. payment not
authorized) — surface both to the agent.

---

## 7. Safety model

- **Read by default, write opt-in.** Writes require `STORE_MCP_ENABLE_WRITE`.
  With it off, the write tools don't even appear in `tools/list`.
- **Scoping is enforced by the route, not the tool.** Every write proxies through
  the publishable-key-scoped `/store/*` route, so a cart can only contain
  products in that storefront's sales channel.
- **Public keys only.** No admin auth is involved. The optional forwarded
  `Authorization` bearer (`ctx.bearer`) is reserved for future customer-authed
  tools (e.g. `orders/me`); the checkout tools work as guest checkout.
- **Payment is provider-mediated.** `initialize_payment_session` only creates a
  session for a provider; actual charge/authorization happens via the provider
  (Stripe, manual/`pp_system_default`, etc.). The MCP server never sees card data.

---

## 8. Configuration

| Env var | Purpose |
|---------|---------|
| `STORE_MCP_DEFAULT_PUBLISHABLE_KEY` | Last-resort key when a call has no `store` arg and no header. Set to the main storefront's public key. |
| `STORE_MCP_ENABLE_WRITE` | `true`/`1`/`yes` to enable cart & payment write tools. Default off (read-only). |
| `STORE_MCP_LOOPBACK_URL` | Override the loopback origin (default: derived from the request, e.g. `http://localhost:9000`). |

---

## 9. Gotchas (learned the hard way)

- **`@modelcontextprotocol/sdk@1.29` only exports coarse subpaths.** Import the
  `.js` specifiers (`/server/index.js`, `/server/streamableHttp.js`, `/types.js`).
  The bare root `.` import is broken (no `dist/esm/index.js`).
- **Test runner truncates the DB before every test except the first.** Seed in
  `beforeEach`, not `beforeAll`, or only the first test sees the data.
- **Stateless transport needs the parsed body handed in.** Medusa's body parser
  already consumed the stream, so `handler.ts` passes `req.body` to
  `transport.handleRequest(...)` explicitly.
- **`semantic_search` is a GET** (the route doc-comment says POST but the handler
  is GET).
- **Write tools: let Medusa validate.** Don't tighten the MCP `inputSchema` to
  mirror the route validator — you'll drift. Keep it loose and surface the
  route's 400 message via the in-band error.
</content>
