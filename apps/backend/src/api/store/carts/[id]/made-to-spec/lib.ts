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

/** On a one-time setup-fee line that a priced choice added (#2456). */
export const MADE_TO_SPEC_SETUP_METADATA_KEY = "made_to_spec_setup_fee"

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

export type SpecOptionValue = {
  id?: string
  label: string
  note?: string | null
  available?: boolean
  order?: number
  /** #2456 — GST-inclusive surcharge per unit; null/0 = free. */
  price_per_piece?: number | string | null
  /** #2456 — GST-inclusive one-time fee per new design; null/0 = none. */
  setup_fee?: number | string | null
  price_currency_code?: string | null
}

export type SpecOption = {
  id?: string
  key: string
  label?: string | null
  help_text?: string | null
  required?: boolean
  order?: number
  /** Offered only on these variants; null/empty = the whole product. */
  variant_ids?: string[] | null
  values?: SpecOptionValue[]
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
  options?: SpecOption[]
} | null

export type MadeToSpecSelection = {
  /** Colour name as published in the palette. Matched case-insensitively. */
  color?: string | null
  /** Free text from the customer — a monogram, a length, an occasion date. */
  note?: string | null
  /**
   * The partner-defined choices, keyed by the option's `key` and valued by the
   * chosen value's LABEL — which is what the customer saw and what the read
   * route published. Keyed by id instead would be tidier to validate and worse
   * to debug: an order line reading `psov_01J…` tells a support conversation
   * nothing.
   */
  options?: Record<string, string> | null
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
  /**
   * What the customer CHOSE, as against `spec_fields` which is what the partner
   * stated. Copied label-and-all for the same reason the colour is: the partner
   * may rename "Kashida — cuff only" next month, and the order must still read
   * the way it was agreed.
   */
  /** #2456 — how a priced line's custom unit price was built. */
  pricing?: {
    base_unit_price: number
    surcharge_per_piece: number
    currency_code: string
    per_piece: {
      key: string
      value: string
      amount: number
      original_amount: number
      original_currency: string
    }[]
  }
  options?: {
    key: string
    label: string
    value: string
    note?: string | null
    /**
     * #2456 — what the choice cost AT THE TIME, in its own currency. Copied
     * like the label: a partner raising the embroidery price next month must
     * not rewrite what this customer was charged.
     */
    price_per_piece?: number
    setup_fee?: number
    price_currency_code?: string
  }[]
  captured_at: string
}

const normalize = (value: string) => value.trim().toLowerCase()

/** A bigNumber column reads back as a number, a string or null. */
const toAmount = (v: unknown): number => {
  if (v === null || v === undefined || v === "") return 0
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n : 0
}

/**
 * The price half of a chosen value, or nothing for a free choice. A priced
 * value with no currency is refused rather than guessed — the validator
 * already blocks it on write, so reaching here means a row written around it.
 */
const pricedFields = (value: SpecOptionValue, groupLabel: string) => {
  const perPiece = toAmount(value.price_per_piece)
  const setup = toAmount(value.setup_fee)
  if (!perPiece && !setup) return {}
  const currency = value.price_currency_code?.trim().toLowerCase()
  if (!currency) {
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      `${groupLabel}: "${value.label}" has a price but no currency, so it cannot be charged. Please contact us.`
    )
  }
  return {
    ...(perPiece ? { price_per_piece: perPiece } : {}),
    ...(setup ? { setup_fee: setup } : {}),
    price_currency_code: currency,
  }
}

export type MadeToSpecCharge = {
  key: string
  label: string
  value: string
  amount: number
  currency_code: string
}

/**
 * PURE. What the chosen values add: per-piece surcharges (folded into the
 * line's unit price) and one-time setup fees (each its own cart line).
 * Amounts stay in each value's own currency; the route converts.
 */
export const madeToSpecCharges = (
  snapshot: Pick<MadeToSpecSnapshot, "options">
): { per_piece: MadeToSpecCharge[]; setup: MadeToSpecCharge[] } => {
  const per_piece: MadeToSpecCharge[] = []
  const setup: MadeToSpecCharge[] = []
  for (const o of snapshot.options ?? []) {
    if (!o.price_currency_code) continue
    const base = {
      key: o.key,
      label: o.label,
      value: o.value,
      currency_code: o.price_currency_code,
    }
    if (o.price_per_piece) per_piece.push({ ...base, amount: o.price_per_piece })
    if (o.setup_fee) setup.push({ ...base, amount: o.setup_fee })
  }
  return { per_piece, setup }
}

/**
 * Resolve the partner-defined option groups against what the customer picked.
 *
 * The rule is the palette's rule, applied to an axis the partner named: a value
 * counts only if the partner listed it AND left it available. Two cases are
 * worth stating because they are the ones a storefront gets wrong:
 *
 * - A group whose values are ALL unavailable is not silently skipped when it is
 *   `required`. Skipping would let the piece be ordered without an axis it
 *   cannot be made without, and the partner would find out at the loom. It is
 *   rejected loudly instead; an optional group in that state is simply not
 *   offered.
 * - An unknown key is rejected rather than ignored. A storefront sending
 *   `embroidery` at a spec that has since dropped the group is stale, and
 *   dropping the value quietly would record an order the customer did not place.
 */
const resolveOptionSelections = (
  specOptions: SpecOption[],
  selected: Record<string, string> | null | undefined,
  variantId?: string | null
): MadeToSpecSnapshot["options"] => {
  const all = (specOptions ?? [])
    .slice()
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))

  // #2456 — a group scoped to other variants is not on offer for this one.
  // Without a variant to check against (an old caller), nothing is scoped out.
  const offeredHere = (o: SpecOption) =>
    !variantId || !o.variant_ids?.length || o.variant_ids.includes(variantId)
  const groups = all.filter(offeredHere)

  const byKey = new Map(groups.map((o) => [normalize(o.key), o]))

  for (const key of Object.keys(selected ?? {})) {
    if (!byKey.has(normalize(key))) {
      const elsewhere = all.find((o) => normalize(o.key) === normalize(key))
      if (elsewhere) {
        throw new MedusaError(
          MedusaError.Types.INVALID_DATA,
          `${(elsewhere.label ?? elsewhere.key).trim()} is not offered on this variant.`
        )
      }
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        groups.length
          ? `"${key}" is not an option on this product. Options: ${groups
              .map((o) => o.key)
              .join(", ")}.`
          : `"${key}" is not an option on this product.`
      )
    }
  }

  const chosen: NonNullable<MadeToSpecSnapshot["options"]> = []

  for (const group of groups) {
    const label = (group.label ?? group.key).trim()
    const available = (group.values ?? [])
      .filter((v) => v.available !== false)
      .slice()
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))

    const raw = (selected ?? {})[group.key] ?? (selected ?? {})[normalize(group.key)]
    const requested = typeof raw === "string" ? raw.trim() : ""

    if (!available.length) {
      if (group.required) {
        throw new MedusaError(
          MedusaError.Types.NOT_ALLOWED,
          `${label} is required for this piece, but none of its choices are available right now.`
        )
      }
      // Optional and nothing to offer — not a choice at all this week.
      if (requested) {
        throw new MedusaError(
          MedusaError.Types.INVALID_DATA,
          `${label} has no choices available right now.`
        )
      }
      continue
    }

    if (!requested) {
      if (group.required) {
        throw new MedusaError(
          MedusaError.Types.INVALID_DATA,
          `Choose ${label}. Available: ${available.map((v) => v.label).join(", ")}.`
        )
      }
      continue
    }

    const match = available.find((v) => normalize(v.label) === normalize(requested))
    if (!match) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `"${requested}" is not available for ${label}. Available: ${available
          .map((v) => v.label)
          .join(", ")}.`
      )
    }

    chosen.push({
      key: group.key,
      label,
      value: match.label,
      ...(match.note ? { note: match.note } : {}),
      ...pricedFields(match, label),
    })
  }

  return chosen
}

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
  variantId,
}: {
  spec: ProductSpecRecord
  selection: MadeToSpecSelection
  now: Date
  /** The variant being ordered, so variant-scoped choices apply (#2456). */
  variantId?: string | null
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

  const chosenOptions = resolveOptionSelections(
    spec.options ?? [],
    selection.options,
    variantId
  )

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
    ...(chosenOptions?.length ? { options: chosenOptions } : {}),
    captured_at: now.toISOString(),
  }
}
