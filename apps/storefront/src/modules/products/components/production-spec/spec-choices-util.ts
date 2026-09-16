import type { StoreProductSpec } from "@lib/data/product-spec"

/**
 * #1365 — the made-to-order configurator's shared rules.
 *
 * Pure functions, no React, so the server component that decides WHERE the
 * choices render (inline, or behind a link to /customise) and the client
 * component that renders them agree by construction. Two copies of this
 * arithmetic would drift the day someone changes the overflow threshold.
 */

export type SpecChoiceState = {
  color: string | null
  options: Record<string, string>
  note: string
}

/**
 * A group the customer actually chooses between. Colours are ONE group however
 * many swatches the partner offers — the founder's rule, and it matches how the
 * page reads: a row of swatches is one decision, not eight.
 */
export const countChoiceGroups = (spec: StoreProductSpec | null): number => {
  if (!spec) return 0
  const colourGroup = spec.colors.length ? 1 : 0
  return colourGroup + (spec.options ?? []).length
}

/** The widest group, measured in values. Colours count via their own length. */
export const widestGroupSize = (spec: StoreProductSpec | null): number => {
  if (!spec) return 0
  return Math.max(
    spec.colors.length,
    0,
    ...(spec.options ?? []).map((o) => o.values.length)
  )
}

/**
 * Overflow to the second step at >2 groups, or any group with >6 values.
 *
 * Both halves matter: three narrow groups crowd the buying column just as badly
 * as one group of twelve swatches, and either alone would let the other through.
 */
export const needsSecondStep = (spec: StoreProductSpec | null): boolean => {
  if (!spec || !spec.accepting_custom_orders) return false
  return countChoiceGroups(spec) > 2 || widestGroupSize(spec) > 6
}

/**
 * NOTHING is preselected — not colour, not add-ons, and (since #1970) not
 * required groups either.
 *
 * 🔴 Required groups used to default to their first orderable value, "so the
 * common path is one click". That was safe only while the value was decorative,
 * and it stopped being safe the moment a required group decides WHAT GETS MADE.
 * A design's sizes are exactly that: the page opened with "S" already chosen on
 * the customer's behalf, and `hasAnySpecChoice` then had to discount it —
 * because counting a value we picked ourselves would place a made-to-order for
 * S for anyone who never touched the control.
 *
 * The two rules were locked together: preselect and you must not count it;
 * count it and you must not preselect. Keeping the prefill meant the customer's
 * real answer was thrown away, and a garment reached production with no size on
 * it. So the prefill goes, the answer counts, and `unansweredRequiredGroups`
 * below stops the sale until the question is actually answered.
 */
export const initialSpecChoices = (
  _spec: StoreProductSpec | null
): SpecChoiceState => ({
  color: null,
  options: {},
  note: "",
})

/**
 * Has the customer expressed a made-to-order intent?
 *
 * This is the whole hinge of the single button: false means an ordinary
 * add-to-cart, true means made-to-spec. A note alone counts — someone who
 * typed "wider border if possible" has asked for a piece to be made.
 */
export const hasAnySpecChoice = (
  spec: StoreProductSpec | null,
  value: SpecChoiceState
): boolean => {
  if (!spec?.accepting_custom_orders) return false
  if (value.color) return true
  if (value.note.trim()) return true
  /**
   * 🔴 EVERY group counts now, required included.
   *
   * This used to read `!o.required`, on the grounds that a required group's
   * value was our prefill rather than the customer's answer. With the prefill
   * gone (see `initialSpecChoices`) a value in a required group can only have
   * come from a click, and it is the strongest statement of intent on the page
   * — often the only one, for a design whose single axis is its size.
   *
   * While it read `!o.required`, a customer could choose "L", add to cart, and
   * have the line recorded as an ordinary purchase with no size on it at all.
   */
  return (spec.options ?? []).some((o) => !!value.options[o.key])
}

/**
 * Required groups THIS PAGE is asking about and the customer has not answered —
 * the reason the buy button waits.
 *
 * Distinct from `blockedGroups`, and the difference is who can fix it: a
 * blocked group is the PARTNER's problem (nothing orderable in it), while an
 * unanswered one is simply a question still open. Groups with no orderable
 * values are excluded so the two never double-report the same row.
 *
 * 🔴 EMPTY when the spec overflows to the second step, and that guard is not
 * cosmetic. Past two groups (or one wide one) the choices are NOT rendered
 * here — the page shows a summary and a "Customise this piece →" link, and its
 * buy button is the BUY-IT-AS-IS path. Holding that button for an unanswered
 * group would strand the customer: a disabled button asking a question the page
 * does not ask. Found on a live muslin product with 8 groups —
 * `prod_01KMHTK1T1BQ7KWKYWY1NR5RYZ`, two required (dyeing method, dye colour)
 * — while sweeping production for exactly this.
 *
 * One definition, read by the button's `disabled` and by its label, so the
 * page cannot refuse a click for a reason it does not state — or for a
 * question it never asked.
 */
export const unansweredRequiredGroups = (
  spec: StoreProductSpec | null,
  value: SpecChoiceState
) => {
  if (!spec?.accepting_custom_orders) return []
  if (needsSecondStep(spec)) return []
  return (spec.options ?? []).filter(
    (o) => o.required && o.values.length > 0 && !value.options[o.key]
  )
}

/**
 * Required groups the partner has nothing available for. The backend refuses
 * these outright, so the button must too — otherwise the page invites a click
 * whose only outcome is an error.
 */
export const blockedGroups = (spec: StoreProductSpec | null) =>
  (spec?.options ?? []).filter((o) => o.required && !o.values.length)

/** "8 colours · Embroidery · Border" — what the second step is holding. */
export const summariseChoices = (spec: StoreProductSpec | null): string => {
  if (!spec) return ""
  const parts: string[] = []
  if (spec.colors.length) {
    parts.push(
      `${spec.colors.length} colour${spec.colors.length === 1 ? "" : "s"}`
    )
  }
  for (const option of spec.options ?? []) {
    parts.push(option.label)
  }
  return parts.join(" · ")
}

/** "about 10 days" — the wait, phrased for a line under the button. */
export const leadTimePhrase = (spec: StoreProductSpec | null): string | null => {
  if (!spec?.accepting_custom_orders) return null
  return spec.custom_order_lead_time_days
    ? `Woven to order for you — about ${spec.custom_order_lead_time_days} days.`
    : "Woven to order for you after the order is placed."
}
