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
 * Required groups default to their first orderable value so the common path is
 * one click. Optional ones start UNSET on purpose — pre-selecting an add-on is
 * how a customer ends up paying for embroidery they never chose.
 *
 * Colour is deliberately NOT preselected either. With one button, a preselected
 * colour would silently turn every ordinary purchase into a made-to-order one.
 */
export const initialSpecChoices = (
  spec: StoreProductSpec | null
): SpecChoiceState => ({
  color: null,
  options: Object.fromEntries(
    (spec?.options ?? [])
      .filter((o) => o.required && o.values.length)
      .map((o) => [o.key, o.values[0].label])
  ),
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
  // A required group's default is not a choice the customer made — it is our
  // prefill. Only count it once something else marks real intent, which the
  // two checks above already do.
  return (spec.options ?? []).some(
    (o) => !o.required && !!value.options[o.key]
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
