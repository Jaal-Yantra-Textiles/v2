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
   - **Store-first assembly.** `store-resolver.ts` enumerates the `stores` entity
     (the same rich field set as core `GET /admin/stores`:
     `supported_currencies`, `default_region_id`, `default_location_id`, …) and
     joins partner handle/domain on top. So **every** store is returned —
     including the core store that iterating partners alone would miss. A store
     not linked to a partner is flagged `is_default: true` with the apex domain
     (`ROOT_DOMAIN`, default `cicilabel.com`) and sorted first. `resolveStorefront`
     filters this assembled list, so `"default"` / `"main"` / the apex domain /
     a store name/id/sales-channel id all resolve the core store.
   - Each `StorefrontInfo` carries `default_region_id` and `currency_code`, handy
     defaults for `create_cart`.

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
| `payu_generate_upi_intent` | POST | `/store/payu/intent` (INR — UPI deep link) |
| `create_payment_link` | POST | `/store/payu/payment-link` (INR — shareable link) |
| `payu_complete_payment` | POST | `/store/payu/complete` (INR) |
| `payu_refresh_payment` | POST | `/store/payu/refresh` (INR) |

(The PayU dashboard webhook `POST /webhooks/payu/link` — outside `/store`, no tool —
completes a paid payment link into an order.)

`complete_cart` returns `{ type: "order", order }` on success or
`{ type: "cart", cart, error }` if completion failed (e.g. payment not
authorized) — surface both to the agent.

### Resolving the actual payment step (`next_action`)

`initialize_payment_session` doesn't just create the session — it normalizes the
provider's payload into a concrete `next_action` so the agent knows what to do
next, regardless of gateway:

```jsonc
// returns { next_action, payment_collection }
// PayU (pp_payu_*):
{ "next_action": { "type": "redirect_form", "provider": "payu",
    "url": "https://secure.payu.in/_payment", "method": "POST",
    "fields": { "key": "…", "txnid": "…", "amount": "…", "hash": "…", … } } }
// Stripe (pp_stripe_*):
{ "next_action": { "type": "client_secret", "provider": "stripe",
    "client_secret": "pi_…_secret_…" } }
// manual / pp_system_default:
{ "next_action": { "type": "session_ready" } }   // just complete_cart
```

So **PayU resolves to a hosted payment link + signed form fields**, **Stripe hands
over the `client_secret`** for client-side card collection, and manual providers
are immediately completable. The normalization is a pure function
(`paymentNextAction` in `registry.ts`, unit-tested) applied via the tool def's
`transform` hook — the generic way a proxy tool reshapes its response.

### PayU (INR) — the redirect-gateway exception

PayU (provider `pp_payu_payu`, used for INR) is a **redirect + hash gateway**, not
a server-side charge API. That changes the tail of the flow:

```
… create_payment_collection
→ initialize_payment_session({ provider_id: "pp_payu_payu" })
     ⇒ session.data = { payment_url, key, txnid, hash, amount, firstname, email, … }
→ [BROWSER] POST those fields to payment_url (PayU hosted page); shopper pays
     (card / UPI / netbanking); PayU redirects back with a signed callback
→ payu_complete_payment({ cart_id, payu_status, mihpayid, txnid, hash, amount })
     ⇒ { type: "order", order_id }   (or { type: "cart", error } + auto-refresh)
```

- **`initialize_payment_session`** already surfaces everything the redirect needs
  (`payment_url`, `key`, `txnid`, `hash`) in `session.data`, because it proxies
  the native payment-sessions route.
- **`payu_complete_payment`** wraps `POST /store/payu/complete`: it writes the
  callback fields onto the session and runs `completeCartWorkflow`. Use it
  **instead of `complete_cart`** for PayU.
- **`payu_refresh_payment`** wraps `POST /store/payu/refresh`: resets the payment
  collection (deletes stale sessions) so a retry gets a fresh `txnid`/`hash`.

**UPI Intent (`payu_generate_upi_intent`) — the no-redirect, no-card path.** After
a PayU session is initialized, this generates a **`upi://pay?…` deep link** (+ QR)
the customer taps in any UPI app — no hosted-page redirect, no card data:

```
… create_payment_collection → initialize_payment_session({ provider_id: "pp_payu_payu" })
→ payu_generate_upi_intent({ cart_id })  ⇒ { upi_link: "upi://pay?pa=…&am=…&cu=INR", qr_url, txnid }
→ [customer pays in their UPI app] → PayU webhook / payu_complete_payment
```

It wraps `POST /store/payu/intent`, which **replays the session's already-signed
fields** to PayU's S2S `/_payment` (`bankcode=INTENT`) — so it needs no salt and
reuses the same hash the provider built. If PayU returns its HTML page instead of
JSON, S2S UPI Intent isn't enabled on that merchant (409 with a clear message);
fall back to the hosted link. This is the most agent-friendly INR primitive: a
returnable link/QR with zero PCI surface.

### PayU Payment Link (`create_payment_link`) → order (verify-then-complete)

A second INR rail (PayU **OneAPI**, OAuth) that returns a **shareable
`https://v.payu.in/…` link** whose checkout offers UPI + cards. Unlike the
session-based rails, the link is paid out-of-band — so completion is
**webhook-verified**, never trust-the-redirect:

```
create_payment_link({ cart_id })           # amount+customer from the cart; udf1=cart_id
   ⇒ { payment_link, invoice_number }       # invoice_number persisted on cart.metadata
→ customer opens link, pays (UPI/card)
→ PayU dashboard webhook  POST /webhooks/payu/link   (urlencoded, reverse-SHA512 hash)
     1. verify the hash with PAYU_MERCHANT_SALT
     2. re-query OneAPI GET /payment-links/{invoice}/txns → confirm success + amount
     3. completeCartFromExternalPayment(cart) → manual session → completeCartWorkflow → ORDER
```

- **Verify-then-complete**, layered: the webhook hash proves PayU sent it; the
  OneAPI `/txns` re-query proves it was actually paid (webhooks can be replayed).
  Only then does the cart complete.
- The link is collected on PayU's side, so the Medusa payment is modelled with the
  **manual provider** (`PAYU_LINK_COMPLETE_PROVIDER`, default `pp_system_default`)
  and the PayU `txnid`/`mihpayid`/`bank_ref_num` are stored on the session for
  reconciliation. Completion is **idempotent** (duplicate webhook → existing order).
- Pure, unit-tested: `verifyWebhookHash`, `isLinkPaid`, `buildPaymentLinkBody`.
- **Webhook URL is configured in the PayU dashboard** (Developers → Webhooks),
  pointing at `https://<backend>/webhooks/payu/link` — there is no per-link notify
  field in PayU's API. Needs the OneAPI env (below) for the re-query step.
- ⚠️ Assumes the OneAPI merchant and the classic `merchant_key`/`salt` are the
  **same** PayU account (the webhook hash uses the classic salt). End-to-end
  validation needs a live PayU sandbox + a public webhook URL.

**What the MCP cannot do for PayU (by design, not a gap):**
- The hosted-page payment step itself is a **browser redirect** with a
  hash-signed form POST to `test.payu.in` / `secure.payu.in`. An agent can
  *initiate* and *complete*, but the actual card/UPI entry happens in a browser —
  there is no server-side "charge" call to wrap.
- Provider-internal lifecycle methods (`authorizePayment`, `capturePayment`,
  `refundPayment`, `verifyPayment` in `payu-payment/service.ts`) are invoked **by
  Medusa's workflows**, not exposed as `/store/*` routes — so they're out of
  scope for the Store MCP. Refunds are an **admin** concern, not a store one.
- Credentials resolve **per partner** (sales channel → store → partner →
  `partner_payment_config`, falling back to global). The agent never handles
  `merchant_key`/`merchant_salt`; scoping the call to the right `store` is enough.

So: the two PayU **store** routes map cleanly onto MCP tools; the gateway redirect
and the admin/provider-internal operations intentionally do not.

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
| `PAYU_MERCHANT_KEY` / `PAYU_MERCHANT_SALT` | Classic PayU creds — hosted checkout, UPI intent, and the payment-link webhook hash verification. |
| `PAYU_CLIENT_ID` / `PAYU_CLIENT_SECRET` / `PAYU_MERCHANT_ID` | PayU **OneAPI** OAuth creds for `create_payment_link` + the webhook `/txns` re-verification. |
| `PAYU_ONEAPI_MODE` | `test` (UAT, default) or `prod` — selects the `uatoneapi`/`uat-accounts` vs `oneapi`/`accounts` hosts. |
| `PAYU_LINK_COMPLETE_PROVIDER` | Manual provider used to complete a paid link into an order. Default `pp_system_default`. |

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
