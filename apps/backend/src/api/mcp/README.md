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
publishable key). Agents work in terms of **store names**, not raw `pk_` tokens:

1. `list_stores` → discover storefronts (`handle`, `name`, `domain`, `store_id`,
   `publishable_key`).
2. `get_storefront_key({ store: "acme" })` → resolve a storefront's default key by
   handle/subdomain or domain.
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

## Configuration

| Env var | Purpose |
|---------|---------|
| `STORE_MCP_DEFAULT_PUBLISHABLE_KEY` | Optional last-resort key when a call has no `store` arg and no header. Set to the main storefront's public key. |
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
