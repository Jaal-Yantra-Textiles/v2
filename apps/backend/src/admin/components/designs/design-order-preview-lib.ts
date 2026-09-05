import type { DesignEstimatePreview } from "../../hooks/api/designs"

/**
 * The preview drawer's arithmetic, as pure functions.
 *
 * ## Why it is not inline in the component
 *
 * It threw. `est.unit_price.toFixed(2)` ran against a `null` and the drawer
 * died with `null is not an object` before rendering a single row — and the
 * drawer is the ONE screen where an operator can supply the price the backend
 * is asking for, so an unpriceable design made the whole order impossible
 * rather than merely unpriced.
 *
 * 🔑 `null` is a real answer from `/design-order/preview`: it means the
 * estimator had nothing to price from — no bill of materials, no cost history
 * (#1564). It is deliberately NOT zero, because zero is a decision to give
 * something away, and `create-draft-order-from-designs` refuses a null outright
 * rather than putting a 0 on an order line.
 *
 * The repo's admin tests are pure-logic (there is no React renderer here), so
 * the rules that broke live where they can actually be tested.
 */

export type EditableEstimate = {
  material: string
  production: string
  unitPrice: string
}

/**
 * A number for a form field. A null/undefined/NaN becomes an EMPTY field —
 * never `"0.00"`, which would read as a decision nobody made.
 */
export const money = (value: number | null | undefined): string =>
  typeof value === "number" && Number.isFinite(value) ? value.toFixed(2) : ""

/** The form's starting state for a batch of estimates. Never throws. */
export const hydrateEstimates = (
  estimates: DesignEstimatePreview[]
): Record<string, EditableEstimate> => {
  const initial: Record<string, EditableEstimate> = {}
  for (const est of estimates ?? []) {
    initial[est.design_id] = {
      material: money(est.material_cost),
      production: money(est.production_cost),
      unitPrice: money(est.unit_price),
    }
  }
  return initial
}

export type EditSummary = {
  /** Only the lines whose price the operator actually decided. */
  priceOverrides: Record<string, number>
  /** The total of the lines that HAVE a price. */
  computedTotal: number
  hasChanges: boolean
  /** design_ids with no usable price — the create would refuse these. */
  unpriced: string[]
}

/**
 * What the batch currently adds up to, and what is still missing.
 *
 * 🔴 A blank or non-positive field is counted as MISSING, not as zero. Adding
 * it as 0 produced two failures at once: a total that looked complete while it
 * was not, and a Create that the workflow then refused — after the click,
 * naming a design the operator could no longer see.
 */
export const summariseEdits = (
  estimates: DesignEstimatePreview[],
  edited: Record<string, EditableEstimate>
): EditSummary => {
  const priceOverrides: Record<string, number> = {}
  const unpriced: string[] = []
  let computedTotal = 0
  let hasChanges = false

  for (const est of estimates ?? []) {
    const raw = edited?.[est.design_id]?.unitPrice ?? ""
    const typed = raw.trim() === "" ? NaN : parseFloat(raw)

    if (!Number.isFinite(typed) || typed <= 0) {
      unpriced.push(est.design_id)
      continue
    }

    computedTotal += typed

    if (typed !== est.unit_price) {
      priceOverrides[est.design_id] = typed
      hasChanges = true
    }
  }

  return { priceOverrides, computedTotal, hasChanges, unpriced }
}

/** Nothing may be created while a line has no price. */
export const canCreateOrder = (summary: EditSummary): boolean =>
  summary.unpriced.length === 0 && summary.computedTotal > 0
