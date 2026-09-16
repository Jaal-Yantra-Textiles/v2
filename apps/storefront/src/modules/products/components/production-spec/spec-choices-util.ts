import type { StoreProductSpec, StoreSpecOption } from "@lib/data/product-spec"

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
 * Required groups the customer has not answered — the reason a buy button waits.
 *
 * PURE, and deliberately says nothing about WHERE the question is asked. Both
 * surfaces render these choices and both must hold their button, but they
 * disagree about when:
 *
 *   · the product page asks only while the spec fits (`needsSecondStep` false),
 *     so it must not hold its button for a question it never printed — its
 *     button is then the BUY-IT-AS-IS path, and disabling it strands the
 *     customer. It combines this with `!secondStep` itself.
 *   · `/products/:handle/customise` IS the second step and always asks, so it
 *     uses this answer as-is.
 *
 * An earlier version folded `needsSecondStep` in here. That silenced the
 * customise page too — where the questions ARE on screen — so its button
 * invited a click whose only outcome was the backend's
 * "Choose Dye Color. Available: …". Exactly what `blockedGroups` exists to
 * avoid, one page over.
 *
 * Distinct from `blockedGroups`: a blocked group is the PARTNER's problem
 * (nothing orderable in it), an unanswered one is a question still open. Groups
 * with no orderable values are excluded so the two never double-report a row.
 */
export const unansweredRequiredGroups = (
  spec: StoreProductSpec | null,
  value: SpecChoiceState
) => {
  if (!spec?.accepting_custom_orders) return []
  return (spec.options ?? []).filter(
    (o) => o.required && o.values.length > 0 && !value.options[o.key]
  )
}

/**
 * The colour, as one more unanswered required group — when there is a palette
 * and the customer has not picked from it.
 *
 * 🔴 Colour is required by the BACKEND and was invisible to the gate.
 * `unansweredRequiredGroups` filters `spec.options`; the palette lives in
 * `spec.colors`, a different field, and nothing looked at it. While required
 * groups were preselected that never showed: the colour was preselected too.
 * #1970 removed every prefill, and from that moment all four live handloom
 * fabrics had an "Add to cart" button that was enabled, said "Add to cart",
 * and could only ever produce `Choose a colour. Available colours: …` —
 * the exact shape `blockedGroups` exists to prevent.
 *
 * `made-to-spec/lib.ts` refuses UNCONDITIONALLY on a non-empty palette with no
 * colour, so this gate can never withhold a click that would have succeeded;
 * it only turns a guaranteed rejection into a question the page asks.
 *
 * ⚠️ `spec.colors` is already the orderable palette — the store read route
 * drops `available === false` before publishing, the same place it filters
 * option values, so that every storefront agrees on what is orderable. Filter
 * again here and a partner with one switched-off colour gets a gate for a
 * question the backend is not asking.
 */
const COLOUR_GROUP: StoreSpecOption = {
  key: "__colour",
  label: "Colour",
  required: true,
  values: [],
}

/**
 * Everything still standing between the customer and a made-to-spec line.
 *
 * `madeToSpec` is the caller's to answer, and deliberately not inferred here.
 * The same question has two answers one door apart: `/customise` ALWAYS submits
 * made-to-spec, while the product page does so only once the customer has shown
 * made-to-order intent — so a helper that decided for itself would be wrong on
 * one of them. That is precisely how #2075 shipped a gate that was right on the
 * page it was written for and a dead end on the page next to it.
 */
export const unansweredRequired = (
  spec: StoreProductSpec | null,
  value: SpecChoiceState,
  { madeToSpec }: { madeToSpec: boolean }
): StoreSpecOption[] => {
  if (!spec?.accepting_custom_orders) return []
  const colour =
    madeToSpec && spec.colors.length > 0 && !value.color ? [COLOUR_GROUP] : []
  // Colour first: it is rendered above the option groups, so the button names
  // the question the customer meets first rather than one further down.
  return [...colour, ...unansweredRequiredGroups(spec, value)]
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
