# Store MCP server

A read-only [Model Context Protocol](https://modelcontextprotocol.io) server that
exposes the Medusa **Store API** to AI agents (Claude Code, Cursor, Claude Desktop,
and internal Mastra agents). It wraps the live `/store/*` routes over an in-process
loopback, so every tool inherits Medusa's pricing/tax context, sales-channel
scoping, validators, and our custom route overrides.

## Endpoints

| Path | Auth | Use |
|------|------|-----|
| `POST /mcp` | open (zero-config) | Default. No key required to connect; the server resolves the right publishable key per call (see below). |
| `POST /store/mcp` | publishable key **required** | Same server under the gated `/store` namespace, for callers that always send their own `x-publishable-api-key`. |

Stateless Streamable-HTTP transport with JSON responses — each request is a
self-contained JSON-RPC call (no session).

## Connecting

**Claude Code (CLI):**
```bash
claude mcp add --transport http jyt-store https://v3.jaalyantra.com/mcp
```

**Cursor / Claude Desktop** (`mcp.json` / `claude_desktop_config.json`):
```json
{
  "mcpServers": {
    "jyt-store": { "type": "http", "url": "https://v3.jaalyantra.com/mcp" }
  }
}
```

**Pin to one storefront** (skip per-call store selection) — point at the gated
mount with that store's key:
```json
{
  "mcpServers": {
    "jyt-acme": {
      "type": "http",
      "url": "https://v3.jaalyantra.com/store/mcp",
      "headers": { "x-publishable-api-key": "pk_..." }
    }
  }
}
```

**Internal Mastra agent** (`@mastra/mcp`):
```ts
import { MCPClient } from "@mastra/mcp"

const mcp = new MCPClient({
  servers: { jytStore: { url: new URL("http://localhost:9000/mcp") } },
})
const tools = await mcp.getTools()
```

## Multi-tenant: picking a store

The platform runs many partner storefronts (each = one sales channel + one
publishable key) **plus its own core store** (the apex `cicilabel.com`). Agents
work in terms of **store names**, not raw `pk_` tokens:

1. `list_stores` → discover storefronts (`handle`, `name`, `domain`, `store_id`,
   `publishable_key`, `is_default`). The platform core store is included with
   `is_default: true` and listed first.
2. `get_storefront_key({ store: "acme" })` → resolve a storefront's default key by
   handle/subdomain or domain. Use `{ store: "default" }` (or the apex domain) for
   the core store.
3. Pass `store` to any catalog tool — the server resolves it to that store's key:
   ```
   list_products({ store: "acme", q: "saree" })
   ```

**Key resolution precedence per call:** `store` argument → `x-publishable-api-key`
header → `STORE_MCP_DEFAULT_PUBLISHABLE_KEY` env. If none resolve, the tool returns
an in-band error explaining how to scope the request (it never HTTP-500s).

Publishable keys are public storefront keys (`NEXT_PUBLIC_*`), safe to share with
agents; everything here is read-only.

## Tools

**Store discovery (native):** `list_stores`, `get_storefront_key`

**Catalog:** `list_products`, `get_product`, `list_collections`, `get_collection`,
`list_categories`, `get_category`, `list_product_tags`, `list_product_types`,
`list_product_variants`, `semantic_search`

**Storefront config:** `list_regions`, `get_region`, `list_currencies`,
`list_return_reasons`

**Custom:** `list_raw_materials`, `get_production_story`

Catalog/config tools accept a `fields` selector (e.g. `"id,title,handle"`) and the
optional `store` arg. `semantic_search` is natural-language (LLM-interpreted vector
search with a lexical fallback).

To wrap another store endpoint, add one row to `lib/registry.ts`.

## Write tools (cart & checkout) — opt-in

Off by default. Set `STORE_MCP_ENABLE_WRITE=true` to expose the mutating
cart → checkout → pay tools (otherwise they're hidden from `tools/list` and
rejected by `tools/call`). They proxy the matching native `/store` routes, so
sales-channel scoping, pricing/tax, and validators still apply.

**Writes require the keyed mount.** Even with `STORE_MCP_ENABLE_WRITE=true`, the
write tools are only exposed on the gated **`/store/mcp`** mount (which validates
the `x-publishable-api-key` header). They are hidden/blocked on the open `/mcp`
mount, so the zero-config endpoint stays read-only and writes are never callable
anonymously. Point write clients at `/store/mcp` with a publishable key.

**Cart:** `create_cart`, `get_cart`, `update_cart`, `add_line_item`,
`update_line_item`, `remove_line_item`, `add_promotion`

**Checkout / pay:** `list_shipping_options`, `add_shipping_method`,
`list_payment_providers`, `create_payment_collection`,
`initialize_payment_session`, `complete_cart`

**PayU (INR):** `create_payment_link` (OneAPI shareable `v.payu.in/…` link;
paying it auto-completes the cart into an order via the verified
`/webhooks/payu/link` webhook), `payu_generate_upi_intent`,
`payu_complete_payment`, `payu_refresh_payment` — PayU (`pp_payu_payu`) is a
redirect gateway;
`initialize_payment_session` returns the `payment_url`/`hash`/`txnid` a browser
posts to PayU's page, then `payu_complete_payment` finishes the order from the
redirect callback (use it instead of `complete_cart`). `payu_generate_upi_intent`
turns the session into a `upi://pay` deep link + QR (no redirect, no card). See
the guide for the full flow + boundaries.

Typical agent flow:

```
create_cart → add_line_item* → update_cart (email + address)
→ list_shipping_options → add_shipping_method
→ list_payment_providers → create_payment_collection
→ initialize_payment_session → complete_cart   ⇒  { type: "order", order }
```

Architecture, the full route table, and how to author new tools:
`apps/docs/notes/STORE_MCP_SERVER_GUIDE.md`.

## Configuration

| Env var | Purpose |
|---------|---------|
| `STORE_MCP_DEFAULT_PUBLISHABLE_KEY` | Optional last-resort key when a call has no `store` arg and no header. Set to the main storefront's public key. |
| `STORE_MCP_ENABLE_WRITE` | `true`/`1`/`yes` to enable cart & payment write tools. Default off (read-only). |
| `STORE_MCP_DEFAULT_STORE_DOMAIN` | Optional. Apex domain reported for the platform core store. Falls back to `ROOT_DOMAIN`, then `cicilabel.com`. |
| `STORE_MCP_LOOPBACK_URL` | Optional. Override the loopback origin (default: derived from the request, e.g. `http://localhost:9000`). |

## Layout

```
src/api/mcp/
├── route.ts              POST /mcp        (open mount)
└── lib/
    ├── handler.ts        transport wiring + key resolution
    ├── server.ts         tools/list + tools/call dispatch
    ├── registry.ts       declarative tool -> endpoint table
    ├── proxy.ts          loopback fetch to /store/*
    └── store-resolver.ts native store discovery / key resolution
src/api/store/mcp/route.ts  POST /store/mcp (gated mount)
```
