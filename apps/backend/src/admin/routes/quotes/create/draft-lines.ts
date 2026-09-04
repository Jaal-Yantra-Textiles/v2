/**
 * The basket, both ways: form → draft lines, and draft lines → form (#1806).
 *
 * ## Why this is a module and not two inline `.map`s
 *
 * The grid renders a **Discount %** and a **Unit price** column, and for three
 * months every layer between them and the mint dropped the number. The operator
 * typed a negotiated price, saw *"Items saved."*, and the quote minted at
 * retail — the single worst way for a save to fail, because the screen agreed
 * with them.
 *
 * The reason it could happen twice over is that the basket is built in TWO
 * places: the items modal's Save, and the draft page's Mint (which re-saves the
 * basket from its own form first, so a mapping that forgets a field there wipes
 * one the modal had just persisted). Two homes for one mapping is how this
 * regresses. There is one home now, and it is tested.
 *
 * 🔑 The pair is deliberately symmetrical: whatever `draftLinesFromForm` sends,
 * `basketFromDraftLines` must be able to read back. A round trip that loses a
 * field is the same silent discard wearing a different coat.
 */

/** The per-variant maps the grid writes into. */
export type BasketFormValues = {
  quantities?: Record<string, number | null | undefined> | null
  discounts?: Record<string, number | null | undefined> | null
  overrides?: Record<string, number | null | undefined> | null
  weights?: Record<string, number | null | undefined> | null
  design_by_variant?: Record<string, string> | null
}

/** A line as the draft PATCH / mint bodies accept it. */
export type DraftLinePayload = {
  variant_id: string
  quantity: number
  position: number
  design_id?: string
  discount_percent?: number
  override_unit_amount?: number
  unit_weight_grams?: number
}

/**
 * A number the operator actually gave.
 *
 * 🔴 `> 0`, not `!= null`. A blank cell in the DataGrid arrives as `0` or `""`
 * on its way through, and a zero is not "no answer" here — a 0 unit price asks
 * the backend to mint an ACTIVE price of zero, and a 0 weight is a weightless
 * consignment every carrier rates at its floor (#1430). Both are refused
 * downstream, but they must never be SENT as though they were typed.
 *
 * A 0% discount is likewise indistinguishable from an empty cell, and means
 * exactly the same thing — retail — so dropping it costs nothing.
 */
const typed = (value: unknown): number | undefined => {
  const n = typeof value === "number" ? value : Number(value)
  return Number.isFinite(n) && n > 0 ? n : undefined
}

/**
 * Build the basket the draft rail persists.
 *
 * Lines are keyed by variant because that is how every per-line map in the form
 * is keyed — one basket, not four that have to be kept in step.
 */
export const draftLinesFromForm = (
  values: BasketFormValues
): DraftLinePayload[] =>
  Object.entries(values.quantities ?? {})
    .filter(([, qty]) => typeof qty === "number" && qty > 0)
    .map(([variant_id, quantity], index) => {
      const discount = typed(values.discounts?.[variant_id])
      const override = typed(values.overrides?.[variant_id])
      const weight = typed(values.weights?.[variant_id])
      const design = values.design_by_variant?.[variant_id]

      return {
        variant_id,
        quantity: quantity as number,
        position: index,
        ...(design ? { design_id: design } : {}),
        /**
         * 🔑 The override WINS when both are somehow set. The schemas refuse
         * the pair on both rails, so this is unreachable through the API — but
         * an operator can type into both cells, and sending both would meet
         * them as a 400 naming a field rather than as the flat price they just
         * asked for. `conflictingOverrides` reports it so the modal can say so
         * before saving.
         */
        ...(override !== undefined
          ? { override_unit_amount: override }
          : discount !== undefined
            ? { discount_percent: discount }
            : {}),
        ...(weight !== undefined ? { unit_weight_grams: weight } : {}),
      }
    })

/**
 * Variant ids where the operator has typed BOTH a discount and a flat price.
 *
 * "Which one wins" is not a question that should have an answer — the mint
 * validator refuses the pair outright. Named here so the modal can refuse it
 * with the line in hand instead of forwarding a 400.
 */
export const conflictingOverrides = (values: BasketFormValues): string[] =>
  Object.entries(values.quantities ?? {})
    .filter(([, qty]) => typeof qty === "number" && qty > 0)
    .filter(
      ([variant_id]) =>
        typed(values.discounts?.[variant_id]) !== undefined &&
        typed(values.overrides?.[variant_id]) !== undefined
    )
    .map(([variant_id]) => variant_id)

/** A stored draft line, as the GET returns it. */
export type StoredDraftLine = {
  variant_id: string
  product_id?: string | null
  design_id?: string | null
  quantity: number
  override_kind?: "discount_percent" | "override_unit_amount" | null
  override_input_amount?: number | string | null
  quoted_unit_weight_grams?: number | string | null
}

/**
 * The reverse: rebuild the form's per-variant maps from what was stored.
 *
 * Without this the modal reopens with the price cells blank over a line that
 * HAS a negotiated price — and the next Save, built from those blanks, erases
 * it. A hydration gap and a save gap produce the same lost number.
 *
 * 🔑 `Number(...)` only after a `!= null` guard: `override_input_amount` is a
 * bigNumber column, and `Number(null)` is `0` — which would read back as a
 * typed zero on every ordinary line.
 */
export const basketFromDraftLines = (lines: StoredDraftLine[] | null | undefined) => {
  const quantities: Record<string, number> = {}
  const discounts: Record<string, number> = {}
  const overrides: Record<string, number> = {}
  const weights: Record<string, number> = {}
  const design_by_variant: Record<string, string> = {}
  /**
   * 🔴 `{ id }` OBJECTS, not bare ids.
   *
   * `product_ids` is `z.array(z.object({ id }))`, and both steps read it as
   * `ids.map((p) => p.id)`. Hydrated as plain strings that map yields
   * `undefined` for every entry, so the selected-product set matches nothing:
   * reopening a saved draft showed an EMPTY quantities grid over a basket that
   * was fully populated in the database. The trade price cannot be typed onto a
   * row that is not rendered, which is how #1806 survived being looked at.
   */
  const product_ids: { id: string }[] = []
  const seenProducts = new Set<string>()

  for (const line of lines ?? []) {
    quantities[line.variant_id] = line.quantity
    if (line.design_id) design_by_variant[line.variant_id] = line.design_id
    if (line.product_id && !seenProducts.has(line.product_id)) {
      seenProducts.add(line.product_id)
      product_ids.push({ id: line.product_id })
    }

    if (line.override_input_amount != null) {
      const amount = Number(line.override_input_amount)
      if (Number.isFinite(amount)) {
        if (line.override_kind === "discount_percent") {
          discounts[line.variant_id] = amount
        } else if (line.override_kind === "override_unit_amount") {
          overrides[line.variant_id] = amount
        }
      }
    }

    if (line.quoted_unit_weight_grams != null) {
      const grams = Number(line.quoted_unit_weight_grams)
      if (Number.isFinite(grams)) weights[line.variant_id] = grams
    }
  }

  return { quantities, discounts, overrides, weights, design_by_variant, product_ids }
}
