/**
 * The MCP/assistant-facing description of a production spec (#1346).
 *
 * Lives with the module rather than in a registry because BOTH surfaces expose
 * the same spec: the partner writes their own product's spec, an admin writes
 * anyone's, and a schema kept in two registries is one edit from the two
 * assistants believing different things about what a spec is.
 *
 * The weave enum is derived from the catalog, not typed out, so a technique
 * added to `weaving-techniques.ts` is offered to the model without a second
 * edit — and a technique removed cannot linger here as a value the workflow
 * will reject.
 */
import { SUPPORTED_WEAVES } from "./weaving-techniques"

/** Body keys the dispatcher forwards to the spec route, in registry order. */
export const PRODUCT_SPEC_BODY_PARAMS = [
  "weave_technique",
  "weave_label",
  "params",
  "finishes",
  "notes",
  "accepting_custom_orders",
  "custom_order_lead_time_days",
  "colors",
  "fields",
  "options",
]

/**
 * JSON-Schema properties for the spec body. Merged into each surface's own
 * `obj({...})` so the surface keeps ownership of its path params (`id`) and of
 * whether the tool is required to name a product.
 */
export const productSpecSchemaProps = () => ({
  weave_technique: {
    type: "string",
    description:
      "Weave technique slug from get_spec_catalog. Required before `params` — a parameter is only meaningful against a technique.",
    enum: [...SUPPORTED_WEAVES],
  },
  weave_label: {
    type: "string",
    description:
      "Human label for the weave when the slug alone undersells it, e.g. 'Kani twill, 8 bobbins' (≤ 160 chars).",
  },
  params: {
    type: "object",
    description:
      "Measured parameters keyed by the catalog's param keys (gsm, ends_per_inch, picks_per_inch, warp_yarn_count, weft_yarn_count, loom_width_cm, plus technique-specific ones). Values are numbers and are REJECTED if outside the chosen technique's min/max — call get_spec_catalog first to see the ranges.",
    additionalProperties: { type: "number" },
  },
  finishes: {
    type: "array",
    description: "Finishing steps, e.g. ['washed', 'hand-fringed'] (≤ 20).",
    items: { type: "string" },
  },
  notes: { type: "string", description: "Free-text spec notes (≤ 5000 chars)." },
  accepting_custom_orders: {
    type: "boolean",
    description: "Whether the maker will take custom orders against this spec.",
  },
  custom_order_lead_time_days: {
    type: "integer",
    description: "Lead time in days for a custom order (0–3650).",
  },
  colors: {
    type: "array",
    description:
      "The colour palette. REPLACES the stored palette wholesale when passed — omit the key to leave it alone, pass [] to delete every colour. Max 60.",
    items: {
      type: "object",
      properties: {
        name: { type: "string", description: "Colour name, e.g. 'Saffron'." },
        hex_code: { type: "string", description: "Hex code, e.g. '#C9A227'." },
        usage_notes: { type: "string", description: "Where the colour is used (≤ 500 chars)." },
        order: { type: "integer", description: "Display order (0–999)." },
        available: { type: "boolean", description: "Whether the colour can be ordered." },
      },
      required: ["name"],
      additionalProperties: false,
    },
  },
  fields: {
    type: "array",
    description:
      "Partner-defined spec fields for anything the catalog doesn't cover. REPLACES the stored fields wholesale when passed — omit to leave alone, pass [] to delete all. Max 40.",
    items: {
      type: "object",
      properties: {
        key: { type: "string", description: "Field key, e.g. 'border_width' (≤ 60 chars)." },
        label: { type: "string", description: "Display label (≤ 120 chars)." },
        value: { type: "string", description: "Field value (≤ 500 chars)." },
        order: { type: "integer", description: "Display order (0–999)." },
      },
      required: ["key"],
      additionalProperties: false,
    },
  },
  options: {
    type: "array",
    maxItems: 12,
    description:
      "Choices the CUSTOMER makes when ordering this made to order — embroidery, a border, a colour pattern. Distinct from `fields`, which are facts the partner states and the customer cannot change. Use these instead of product variants when the choice doesn't change what is kept in stock. REPLACES the stored options wholesale when passed — omit to leave alone, pass [] to delete all. Max 12.",
    items: {
      type: "object",
      properties: {
        key: {
          type: "string",
          minLength: 1,
          maxLength: 60,
          description: "Option key, e.g. 'embroidery' (≤ 60 chars).",
        },
        label: {
          type: "string",
          maxLength: 120,
          description: "What the customer sees, e.g. 'Embroidery' (≤ 120 chars).",
        },
        help_text: {
          type: "string",
          description: "One line under the label (≤ 500 chars).",
        },
        required: {
          type: "boolean",
          description:
            "Whether the customer must choose before adding to cart. If true and no value is available, the piece cannot be ordered at all.",
        },
        order: { type: "integer", description: "Display order (0–999)." },
        values: {
          type: "array",
          minItems: 1,
          maxItems: 40,
          description:
            "The selectable values. At least 1, max 40 — a group with none is rejected.",
          items: {
            type: "object",
            properties: {
              label: {
                // The validator is `z.string().trim().min(1)`. Stating that
                // here as well is the point of the row: a caller that sends
                // "" should be told by the schema, not by a 400 naming
                // `options, 0, values, 0, label` — which is exactly what the
                // spec editor did to a partner before the form learned to
                // strip its own blank rows.
                type: "string",
                minLength: 1,
                maxLength: 160,
                description: "What the customer picks by (≤ 160 chars).",
              },
              note: {
                type: "string",
                description: "Detail shown beside the value (≤ 500 chars).",
              },
              order: { type: "integer", description: "Display order (0–999)." },
              available: {
                type: "boolean",
                description:
                  "Orderable right now. Switch off rather than deleting, so orders that already named it still resolve.",
              },
            },
            required: ["label"],
            additionalProperties: false,
          },
        },
      },
      required: ["key", "values"],
      additionalProperties: false,
    },
  },
})

/** Shared guidance appended to the write tool's description on both surfaces. */
export const PRODUCT_SPEC_WRITE_GUIDANCE =
  "Call get_spec_catalog first: `params` are validated against the CHOSEN technique's min/max and the whole write is rejected if any value is out of range. `colors`, `fields` and `options` REPLACE what is stored when passed, so send the full list, not just the additions — read the current spec first or you will delete what you did not resend. This is where a made-to-order product's variable parts belong: the colourways it can be woven in, the choices a buyer makes (embroidery, monogram, finish) as `options`, and anything else the partner wants stated per product as `fields`. Prefer it over creating variants: a colourway here is one row a buyer picks at add-to-cart, whereas the same palette as variants multiplies out against every other option and needs a price per currency for each. Give every colour a `hex_code` — the storefront draws it as a swatch, and a colour without one renders as a bare name."
