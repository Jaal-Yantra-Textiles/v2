import { MedusaError } from "@medusajs/framework/utils"

/**
 * #1349 — validating a customer's made-to-spec choice against the spec the
 * partner actually published, and SNAPSHOTTING it onto the line item.
 *
 * Two rules carry the weight here:
 *
 * 1. The palette is a closed set. A colour is orderable only if the partner
 *    listed it AND left it available. Without this check the storefront is the
 *    only thing standing between a customer and an order for a colourway
 *    nobody can weave — and the storefront is the half an attacker controls.
 *
 * 2. The selection is COPIED onto the line item, never referenced. A spec is a
 *    living document the partner edits; an order is a record of what was
 *    agreed. If the line item held only `color_id`, a partner renaming a colour
 *    or turning off custom orders next week would silently rewrite what a
 *    customer bought last week — and the dispute would be unanswerable. The
 *    lead time is snapshotted for the same reason: it is a promise made at a
 *    point in time.
 */

/** Namespaced so it cannot collide with metadata another feature writes. */
export const MADE_TO_SPEC_METADATA_KEY = "made_to_spec"

export type SpecColor = {
  id?: string
  name: string
  hex_code?: string | null
  usage_notes?: string | null
  available?: boolean
}

export type SpecField = {
  key: string
  label?: string | null
  value?: string | null
}

export type ProductSpecRecord = {
  id?: string
  weave_technique?: string | null
  weave_label?: string | null
  params?: Record<string, number> | null
  finishes?: string[] | null
  accepting_custom_orders?: boolean | null
  custom_order_lead_time_days?: number | null
  colors?: SpecColor[]
  fields?: SpecField[]
} | null

export type MadeToSpecSelection = {
  /** Colour name as published in the palette. Matched case-insensitively. */
  color?: string | null
  /** Free text from the customer — a monogram, a length, an occasion date. */
  note?: string | null
}

/** What ends up on the line item, and later on the order. */
export type MadeToSpecSnapshot = {
  spec_id?: string
  weave?: string | null
  color_name?: string
  color_hex?: string | null
  /** Copied so the order still reads correctly after the spec changes. */
  lead_time_days?: number | null
  note?: string | null
  /** The spec's own fields at time of order — what the piece is made to. */
  spec_fields?: { label: string; value: string }[]
  captured_at: string
}

const normalize = (value: string) => value.trim().toLowerCase()

/**
 * Build the snapshot, or throw a MedusaError the store route surfaces as a 4xx.
 *
 * `now` is injected rather than read from the clock so the snapshot is
 * assertable in a test.
 */
export const buildMadeToSpecSnapshot = ({
  spec,
  selection,
  now,
}: {
  spec: ProductSpecRecord
  selection: MadeToSpecSelection
  now: Date
}): MadeToSpecSnapshot => {
  if (!spec) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      "This product has no production spec, so it cannot be made to order."
    )
  }

  if (!spec.accepting_custom_orders) {
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      "This product is not currently accepting made-to-order requests."
    )
  }

  const palette = (spec.colors ?? []).filter((c) => c.available !== false)
  const requested = selection.color?.trim()

  let color: SpecColor | undefined
  if (requested) {
    color = palette.find((c) => normalize(c.name) === normalize(requested))
    if (!color) {
      // Name what IS orderable. A bare rejection sends the customer back to a
      // page that still shows the colour they picked.
      const available = palette.map((c) => c.name).join(", ")
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        available
          ? `"${requested}" is not available for this product. Available colours: ${available}.`
          : `"${requested}" is not available for this product, and no colours are currently listed.`
      )
    }
  } else if (palette.length) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `Choose a colour. Available colours: ${palette
        .map((c) => c.name)
        .join(", ")}.`
    )
  }

  const note = selection.note?.trim()
  if (note && note.length > 500) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Keep the note under 500 characters."
    )
  }

  const specFields = (spec.fields ?? [])
    .filter((f) => (f.value ?? "").trim())
    .map((f) => ({
      label: (f.label ?? f.key).trim(),
      value: (f.value ?? "").trim(),
    }))

  return {
    ...(spec.id ? { spec_id: spec.id } : {}),
    weave: spec.weave_label?.trim() || spec.weave_technique || null,
    ...(color
      ? { color_name: color.name, color_hex: color.hex_code ?? null }
      : {}),
    lead_time_days: spec.custom_order_lead_time_days ?? null,
    note: note || null,
    ...(specFields.length ? { spec_fields: specFields } : {}),
    captured_at: now.toISOString(),
  }
}
