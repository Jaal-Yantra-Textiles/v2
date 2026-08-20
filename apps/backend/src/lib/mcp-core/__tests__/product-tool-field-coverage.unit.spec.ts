/**
 * Every field a product/variant route ACCEPTS is either advertised by its MCP
 * tool or written down here as a deliberate omission.
 *
 * ## Why this test exists
 *
 * `required-args.unit.spec.ts` already asserts `bodyParams ⊆ inputSchema` — the
 * #1348 direction, "a param the route needs that the schema never offers is
 * silently stripped". That check is one-directional, and it is structurally
 * blind to the failure that actually happened:
 *
 *   `weight` was missing from BOTH `bodyParams` and `inputSchema` on every
 *   single-record product/variant tool, while every route behind them accepted
 *   it. The dispatcher's `pick()` is a pure allowlist walk, so the field was
 *   dropped with no error and no warning — and because the `dry_run` plan is
 *   built from the already-picked body, a dry run could not reveal it either.
 *   The tool returned `ok: true`. Freight was unquotable for a third of a
 *   catalogue and nothing anywhere said so.
 *
 * A field missing from both sides is invisible to a `bodyParams ⊆ schema`
 * check. This test closes that direction by starting from the CONTRACT — core's
 * own zod validators, imported rather than transcribed — and walking inward.
 *
 * ## The opt-out list is the point
 *
 * `DELIBERATELY_OMITTED` is not a way to silence the test. It is the mechanism
 * that converts silence into a decision someone wrote down and dated. Adding a
 * field to it should feel like a small commitment, because it is one.
 */

// Imported, never transcribed: a copy of core's field list here would rot the
// moment core added a field, and rot silently — which is the exact failure this
// test exists to catch. The `./api/*` subpath is in medusa's exports map.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const coreProductValidators = require("@medusajs/medusa/api/admin/products/validators")
const { UpdateProduct, UpdateProductVariant, CreateProductVariant } =
  coreProductValidators

import { PARTNER_MCP_TOOLS } from "../../../api/partners/mcp/lib/registry"
import { ADMIN_MCP_TOOLS } from "../../../api/admin/mcp/lib/registry"
import type { McpToolDef } from "../types"

/** Keys a zod object validator accepts. */
const acceptedKeys = (schema: any): string[] =>
  Object.keys(schema?.shape ?? schema?._def?.shape?.() ?? {})

const findTool = (tools: readonly McpToolDef[], name: string): McpToolDef => {
  const tool = tools.find((t) => t.name === name)
  if (!tool) throw new Error(`tool "${name}" not found — was it renamed?`)
  return tool
}

/**
 * Fields a tool knowingly does not expose, with the reason.
 *
 * Keyed by `<registry>:<tool>`. Anything not listed here MUST be advertised.
 */
const DELIBERATELY_OMITTED: Record<string, Record<string, string>> = {
  "partner:update_product_variant": {
    id: "path param, not a body field",
    prices: "advertised separately with its own array schema",
    options: "advertised separately with its own object schema",
    metadata: "partner tools do not expose raw metadata writes",
    variant_rank: "ordering is a UI concern, not an assistant one",
    ean: "retail barcode symbologies; no partner has asked, and a wrong one is worse than none",
    upc: "as ean",
    barcode: "as ean",
    thumbnail: "images go through the media tools, which handle upload + linking",
  },
  "partner:add_product_variant": {
    prices: "advertised separately with its own array schema",
    options: "advertised separately with its own object schema",
    metadata: "partner tools do not expose raw metadata writes",
    variant_rank: "ordering is a UI concern, not an assistant one",
    ean: "as update_product_variant",
    upc: "as update_product_variant",
    barcode: "as update_product_variant",
    inventory_items: "stock is seeded by set_inventory_level, which this tool already points at",
  },
  "admin:update_product_variant": {
    id: "path param, not a body field",
    prices: "use the pricing tools; a price write here would bypass the FX fanout",
    options: "option writes go through the product tools",
    variant_rank: "ordering is a UI concern",
    ean: "as partner",
    upc: "as partner",
    barcode: "as partner",
    thumbnail: "images go through the media tools",
  },
  "admin:update_product": {
    variants: "variants have their own tools; a nested write here is a second, untested path",
    options: "option writes have their own tool",
    option_ids: "as options",
    images: "images go through the media tools",
    thumbnail: "images go through the media tools",
    sales_channels: "channel membership is its own tool",
    categories: "categories are their own tool",
    tags: "tags are their own tool",
    type_id: "product type is its own tool",
    collection_id: "collections are their own tool",
    shipping_profile_id: "shipping profiles are an ops concern, not an assistant one",
    discountable: "pricing/promotions concern",
    external_id: "integration bookkeeping, never assistant-written",
    is_giftcard: "not a thing this catalogue sells",
  },
}

const CASES: Array<{
  key: string
  tool: McpToolDef
  validator: any
  what: string
}> = [
  {
    key: "partner:update_product_variant",
    tool: findTool(PARTNER_MCP_TOOLS, "update_product_variant"),
    validator: UpdateProductVariant,
    what: "the partner route spreads the raw body into updateProductVariantsWorkflow, so core's contract is the real one",
  },
  {
    key: "partner:add_product_variant",
    tool: findTool(PARTNER_MCP_TOOLS, "add_product_variant"),
    validator: CreateProductVariant,
    what: "the partner route spreads the raw body into createProductVariantsWorkflow",
  },
  {
    key: "admin:update_product_variant",
    tool: findTool(ADMIN_MCP_TOOLS, "update_product_variant"),
    validator: UpdateProductVariant,
    what: "core route, core validator",
  },
  {
    key: "admin:update_product",
    tool: findTool(ADMIN_MCP_TOOLS, "update_product"),
    validator: UpdateProduct,
    what: "core route, core validator",
  },
]

describe("product/variant MCP tools cover the fields their routes accept", () => {
  describe.each(CASES)("$key", ({ key, tool, validator, what }) => {
    const accepted = acceptedKeys(validator)
    const omitted = DELIBERATELY_OMITTED[key] ?? {}

    it(`sanity: the validator was importable and non-empty (${what})`, () => {
      // Without this, a bad import path would make every assertion below pass
      // over an empty set — the test would go green by testing nothing.
      expect(accepted.length).toBeGreaterThan(5)
    })

    it("advertises every accepted field, or names it as a deliberate omission", () => {
      const advertised = new Set(tool.bodyParams ?? [])
      const unaccounted = accepted.filter(
        (field) => !advertised.has(field) && !(field in omitted)
      )

      expect(unaccounted).toEqual([])
    })

    it("advertises nothing the route would reject", () => {
      // The other direction, per-tool: a body param the validator does not
      // accept is a 400 waiting to happen on a .strict() core route.
      const strays = (tool.bodyParams ?? []).filter(
        (field) => !accepted.includes(field)
      )

      expect(strays).toEqual([])
    })

    it("declares every advertised body param in its input schema", () => {
      const props = Object.keys((tool.inputSchema as any)?.properties ?? {})
      const undeclared = (tool.bodyParams ?? []).filter((f) => !props.includes(f))

      expect(undeclared).toEqual([])
    })

    it("has no stale entries in its deliberate-omission list", () => {
      // An omission for a field the validator no longer accepts is a note about
      // a world that stopped existing. Delete it rather than let it rot.
      const stale = Object.keys(omitted).filter((f) => !accepted.includes(f))

      expect(stale).toEqual([])
    })
  })

  it("weight is advertised on every tool that can write one", () => {
    // The regression this whole file exists for, stated plainly so a future
    // reader sees the point without reconstructing it from the generic checks.
    for (const { key, tool } of CASES) {
      expect({ key, weight: (tool.bodyParams ?? []).includes("weight") }).toEqual({
        key,
        weight: true,
      })
    }
  })
})
