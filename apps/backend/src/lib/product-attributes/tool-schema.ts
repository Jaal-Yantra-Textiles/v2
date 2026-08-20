/**
 * The MCP/assistant-facing vocabulary for a product's or variant's PHYSICAL and
 * CUSTOMS attributes — weight, dimensions, and the customs trio.
 *
 * Lives here rather than in a registry for the reason `product-spec/tool-schema.ts`
 * does: these fields belong to four tools across two registries
 * (`update_product_variant`, `add_product_variant`, `update_product`), and a
 * vocabulary copied four times is three edits away from four assistants
 * believing different things about what a product weighs.
 *
 * ## Why this file exists at all
 *
 * `weight` was missing from `bodyParams` on every single-record product/variant
 * tool while being accepted by every route behind them. Because the dispatcher's
 * `pick()` (see `lib/mcp-core/dispatch.ts`) is a pure allowlist walk, the field
 * was dropped with no error, no warning, and — since the `dry_run` plan is built
 * from the already-picked body — a dry run that could not reveal the omission.
 * The tool then returned `ok: true`. Partners set weights through the assistant
 * for days and nothing was written.
 *
 * The fix was never a route change: core's `.strict()` validators for both
 * `POST /admin/products/:id` and `POST /admin/products/:id/variants/:variantId`
 * already accept all of these, and the partner routes spread the raw body into
 * the workflow. The registry was the only thing in the way.
 *
 * 🔑 UNITS. `weight` is **grams** and dimensions are **centimetres** throughout
 * this codebase — the shipping providers all read them that way. The model is
 * the consumer of these descriptions, so the unit is stated in every one of
 * them. A unitless "weight" invites a partner-facing kilogram.
 */

type SchemaProp = { type: string; description: string }

const NUM = (description: string): SchemaProp => ({ type: "number", description })
const STR = (description: string): SchemaProp => ({ type: "string", description })

/**
 * Body keys for physical dimensions, in registry order.
 *
 * Shipping cannot be quoted without `weight`: `/store/shipping-estimate`
 * refuses a weightless variant rather than guessing one, so a variant created
 * or updated without it is unquotable for freight.
 */
export const PHYSICAL_ATTRIBUTE_BODY_PARAMS = [
  "weight",
  "length",
  "width",
  "height",
]

/**
 * Body keys for customs attributes, in registry order.
 *
 * `mid_code` sits here rather than with the others because it is the one core
 * cascades product→variant alongside `hs_code`/`origin_country`/`material`.
 */
export const CUSTOMS_ATTRIBUTE_BODY_PARAMS = [
  "hs_code",
  "origin_country",
  "material",
  "mid_code",
]

/** Both sets, for a tool that should advertise everything a route accepts. */
export const PHYSICAL_AND_CUSTOMS_BODY_PARAMS = [
  ...PHYSICAL_ATTRIBUTE_BODY_PARAMS,
  ...CUSTOMS_ATTRIBUTE_BODY_PARAMS,
]

/** JSON Schema properties for the physical dimensions. */
export const physicalAttributeSchemaProps = (): Record<string, SchemaProp> => ({
  weight: NUM(
    "Shipping weight of ONE unit, in GRAMS (e.g. 115 for a 115g shawl). Required before freight can be quoted — a variant with no weight is refused by the shipping estimate rather than guessed at."
  ),
  length: NUM("Length in CENTIMETRES."),
  width: NUM("Width in CENTIMETRES."),
  height: NUM("Height in CENTIMETRES."),
})

/** JSON Schema properties for the customs attributes. */
export const customsAttributeSchemaProps = (): Record<string, SchemaProp> => ({
  hs_code: STR(
    "HS/HSN customs code. Required for international shipping labels. Assign a real code — the last digits are ITC-HS sub-lines and must never be invented."
  ),
  origin_country: STR("ISO-2 country of manufacture, e.g. 'IN'."),
  material: STR("Material description for customs, e.g. '100% pashmina wool'."),
  mid_code: STR("Manufacturer Identification (MID) code for customs."),
})

/** Everything, for a tool that advertises both sets. */
export const physicalAndCustomsSchemaProps = (): Record<string, SchemaProp> => ({
  ...physicalAttributeSchemaProps(),
  ...customsAttributeSchemaProps(),
})
