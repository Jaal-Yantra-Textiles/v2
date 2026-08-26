// Plain "zod", matching both validators that spread this fragment. Mixing zod
// instances across a spread makes the composed object's types disagree in ways
// that surface as an unrelated-looking error in the consuming file.
import { z } from "zod"

/**
 * The fields that decide what a partner is paid, as a typed request contract.
 *
 * ## Why this exists
 *
 * All four of these reached the submission workflow only through `metadata`,
 * which every route validates as `z.record(z.string(), z.any())`. That is not a
 * contract — it accepts anything. `design_quantities` and `design_quantites`
 * both validated cleanly, and the typo fell through to the workflow's
 * documented "absent means 1" default and billed a per-unit rate once. That is
 * #1554 reachable by a spelling mistake, invisible to tsc, to every unit test,
 * and to the reviewer reading the diff.
 *
 * The amount someone is paid should not depend on the spelling of a JSON key.
 *
 * ## Why it lives here rather than in either validators.ts
 *
 * There are two callers — the admin route and the partner route — and this is
 * one vocabulary. Declared separately they would drift, which is the failure
 * the repair job already demonstrated by keeping its own copy of
 * `APPLIED_AT_KEY` instead of importing the shared one: a rename in one place
 * silently stops the other from matching. One owner, two importers.
 *
 * 🔑 Every value is `.positive()`. A zero or negative rate is dropped by the
 * workflow's sanitizers rather than clamped, so accepting one here would
 * produce a request that validates and then quietly does nothing — the worst of
 * both. Rejecting at the boundary makes the mistake visible to the caller.
 */
export const paymentSubmissionMoneyFields = {
  /** Units billed per design, keyed by design id. Absent means 1. */
  quantities: z.record(z.string(), z.number().positive()).optional(),
  /**
   * Agreed rate per unit, keyed by design id. Beats the design's stored cost —
   * the run's `partner_cost_estimate` is what was agreed with the partner, and
   * `design.estimated_cost` routinely disagrees with it.
   */
  unit_amounts: z.record(z.string(), z.number().positive()).optional(),
  /** Typed line TOTAL per design. Wins outright; never multiplied by quantity. */
  cost_overrides: z.record(z.string(), z.number().positive()).optional(),
  /** Typed line total per task. */
  task_cost_overrides: z.record(z.string(), z.number().positive()).optional(),
} as const

export type PaymentSubmissionMoneyInput = {
  quantities?: Record<string, number>
  unit_amounts?: Record<string, number>
  cost_overrides?: Record<string, number>
  task_cost_overrides?: Record<string, number>
}

/**
 * Fold the typed fields onto the metadata channel the workflow reads.
 *
 * The workflow lifts these off `metadata` (`metadata.design_quantities` and
 * friends), and changing that is a wider blast radius than this fix wants —
 * the partner form posts through metadata today and must keep working. So the
 * typed field is authoritative and lands in metadata on its way through, which
 * is what makes it genuinely take effect rather than being accepted-and-ignored
 * (a whole class of bug this repo has hit before).
 *
 * 🔑 Precedence is per-FIELD and one-way: an explicit field replaces the whole
 * corresponding map. It is deliberately not a per-key merge — a caller that
 * sends `quantities` would otherwise still be overridden key-by-key by a stale
 * metadata blob it never wrote. A caller that sends nothing gets exactly the
 * old behaviour, byte for byte, so no live caller is re-priced by this change.
 */
export const foldMoneyFieldsIntoMetadata = (
  body: PaymentSubmissionMoneyInput & { metadata?: Record<string, any> }
): Record<string, any> => {
  const metadata = { ...(body.metadata || {}) }

  if (body.quantities) metadata.design_quantities = body.quantities
  if (body.unit_amounts) metadata.design_unit_amounts = body.unit_amounts
  if (body.cost_overrides) metadata.design_cost_overrides = body.cost_overrides
  if (body.task_cost_overrides) {
    metadata.task_cost_overrides = body.task_cost_overrides
  }

  return metadata
}
