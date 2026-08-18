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
})

/** Shared guidance appended to the write tool's description on both surfaces. */
export const PRODUCT_SPEC_WRITE_GUIDANCE =
  "Call get_spec_catalog first: `params` are validated against the CHOSEN technique's min/max and the whole write is rejected if any value is out of range. `colors` and `fields` REPLACE what is stored when passed, so send the full list, not just the additions."
