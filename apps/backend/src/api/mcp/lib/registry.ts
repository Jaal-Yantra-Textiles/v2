/**
 * Declarative registry of the Store API endpoints exposed as MCP tools.
 *
 * Each entry maps one MCP tool -> one Medusa Store route. The MCP server is a
 * thin loopback proxy (see proxy.ts): it forwards the tool arguments to the
 * real `/store/*` route, so every tool inherits Medusa's pricing/tax context,
 * query-config defaults, sales-channel scoping, and our custom route overrides
 * (e.g. the /store/products index-engine bugfix) for free.
 *
 * Input schemas are plain JSON Schema (not zod) on purpose: they are returned
 * verbatim to MCP clients in `tools/list`, and they keep this module decoupled
 * from the project's zod version vs the bundled SDK zod.
 *
 * To wrap a new store endpoint, add a row here — no other code changes needed.
 */

export type McpToolDef = {
  /** Tool name surfaced to the agent (snake_case). */
  name: string
  /** One-line description shown in `tools/list`. */
  description: string
  /** JSON Schema for the tool arguments. */
  inputSchema: Record<string, any>
  /** Only GET (read-only) endpoints are wrapped in v1. */
  method: "GET"
  /** Store route path, with `:param` placeholders, e.g. `/store/products/:id`. */
  path: string
  /** Names of `:param` placeholders that must be supplied as arguments. */
  pathParams?: string[]
  /** Argument keys forwarded to the route as query-string params. */
  queryParams?: string[]
}

const PAGINATION_PROPS = {
  limit: {
    type: "integer",
    minimum: 1,
    maximum: 100,
    default: 20,
    description: "Max results to return.",
  },
  offset: {
    type: "integer",
    minimum: 0,
    default: 0,
    description: "Number of results to skip (pagination).",
  },
} as const

const PRICING_PROPS = {
  region_id: {
    type: "string",
    description: "Region id for price/tax context (reg_...).",
  },
  country_code: {
    type: "string",
    description: "Two-letter country code for price/tax context, e.g. 'in'.",
  },
} as const

export const STORE_MCP_TOOLS: McpToolDef[] = [
  {
    name: "list_products",
    description:
      "List published storefront products in the active sales channel. Supports full-text search and filtering by category/collection/handle.",
    method: "GET",
    path: "/store/products",
    queryParams: [
      "q",
      "handle",
      "category_id",
      "collection_id",
      "tag_id",
      "type_id",
      "region_id",
      "country_code",
      "fields",
      "limit",
      "offset",
    ],
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        q: { type: "string", description: "Full-text search term." },
        handle: { type: "string", description: "Filter by exact product handle." },
        category_id: {
          type: "array",
          items: { type: "string" },
          description: "Filter to products in these category ids (pcat_...).",
        },
        collection_id: {
          type: "array",
          items: { type: "string" },
          description: "Filter to products in these collection ids (pcol_...).",
        },
        tag_id: {
          type: "array",
          items: { type: "string" },
          description: "Filter by product tag ids.",
        },
        type_id: {
          type: "array",
          items: { type: "string" },
          description: "Filter by product type ids.",
        },
        fields: {
          type: "string",
          description:
            "Comma-separated field selector, e.g. 'id,title,handle,thumbnail'. Omit price fields to skip pricing context.",
        },
        ...PRICING_PROPS,
        ...PAGINATION_PROPS,
      },
    },
  },
  {
    name: "get_product",
    description:
      "Retrieve a single storefront product by id, including variants. Pass region_id or country_code to get calculated prices.",
    method: "GET",
    path: "/store/products/:id",
    pathParams: ["id"],
    queryParams: ["region_id", "country_code", "fields"],
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["id"],
      properties: {
        id: { type: "string", description: "Product id (prod_...)." },
        fields: {
          type: "string",
          description:
            "Comma-separated field selector, e.g. 'id,title,handle,thumbnail'. Omit price fields to skip pricing context.",
        },
        ...PRICING_PROPS,
      },
    },
  },
]
