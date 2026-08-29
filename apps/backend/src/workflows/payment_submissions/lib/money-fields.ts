// Plain "zod", matching both validators that spread this fragment. Mixing zod
// instances across a spread makes the composed object's types disagree in ways
// that surface as an unrelated-looking error in the consuming file.
import { MedusaError } from "@medusajs/framework/utils"
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
  /**
   * Per-piece prices within one design's line, keyed by design id (#1596).
   *
   * "3 at 850 and 1 at 1,200" — the shape a single `unit_amount` cannot hold. A
   * partner may legitimately charge different rates for different pieces of one
   * run, and until now the only ways to say so were to average it (the total
   * right, the explanation a fiction) or to split the work into extra runs
   * purely to express pricing.
   *
   * 🔑 At least TWO bands. One band is an ordinary priced line and belongs in
   * `quantities` + `unit_amounts`, where every existing reader already looks;
   * accepting it here would create a second spelling of a fact that already has
   * one.
   *
   * ⚠️ Like `production_run_ids`, this is NOT folded into `metadata`. It has no
   * legacy caller, so it never touches the untyped channel at all.
   */
  rate_breakdown: z
    .record(
      z.string(),
      z
        .array(
          z.object({
            quantity: z.number().positive(),
            unit_amount: z.number().positive(),
          })
        )
        .min(2)
    )
    .optional(),
  /**
   * WHICH completed production runs each design line is paying for, keyed by
   * design id. An array because a line is keyed by design and one design can
   * have several completed runs — they collapse into one item whose quantity
   * is their sum.
   *
   * 🔑 Not money, but the PROVENANCE of money, and the thing that decides
   * whether the same run can be billed twice. It lives beside the money fields
   * for the same reason they are here: one vocabulary, two importers, no
   * drift.
   *
   * ⚠️ Unlike the four above, this is NOT folded into `metadata` — it is
   * passed straight through as a typed workflow input. The fold exists only
   * because the partner form has always posted the money fields through
   * `metadata` and must keep working; this field has no such legacy caller, so
   * it never touches the untyped channel at all.
   */
  production_run_ids: z
    .record(z.string(), z.array(z.string().min(1)).min(1))
    .optional(),
} as const

export type PaymentSubmissionMoneyInput = {
  quantities?: Record<string, number>
  unit_amounts?: Record<string, number>
  cost_overrides?: Record<string, number>
  task_cost_overrides?: Record<string, number>
  /** design id → the completed run ids that line pays for. */
  production_run_ids?: Record<string, string[]>
  /** design id → its per-piece price bands (#1596). At least two. */
  rate_breakdown?: Record<string, Array<{ quantity: number; unit_amount: number }>>
}

/**
 * The `metadata` keys the workflow still reads money from, for callers that
 * have not moved to the typed fields.
 */
export const LEGACY_MONEY_METADATA_KEYS = [
  "design_cost_overrides",
  "task_cost_overrides",
  "design_quantities",
  "design_unit_amounts",
] as const

/** Levenshtein distance, capped — we only care about "close". */
const distance = (a: string, b: string): number => {
  if (a === b) return 0
  if (Math.abs(a.length - b.length) > 3) return 99
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const row = [i]
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(
        prev[j] + 1,
        row[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      )
    }
    prev = row
  }
  return prev[b.length]
}

/**
 * PURE: a `metadata` key that is *almost* one of the money keys.
 *
 * 🔴 This is the actual #1554-by-typo defence. The typed fields protect a
 * caller that uses them; they do nothing for a caller that posts
 * `metadata.design_quantites` — that key validates cleanly against
 * `z.record(z.string(), z.any())`, is read by nothing, and the line silently
 * falls through to the workflow's "absent means 1" default. The result is a
 * per-unit rate billed once, invisible to tsc, to every test, and to the
 * reviewer reading the diff.
 *
 * Sanitizers cannot catch this: there is no bad VALUE to reject, only a fact
 * that never arrived. The only place it is visible is the boundary, by noticing
 * that someone clearly meant a key we know.
 *
 * Exact matches are fine (that is the legacy channel, still honoured). Distant
 * keys are fine (ordinary metadata). Only the near-misses are refused, and the
 * message names the key they meant.
 */
export const nearMissMoneyKey = (
  metadata: Record<string, unknown> | null | undefined
): { key: string; meant: string } | null => {
  for (const key of Object.keys(metadata || {})) {
    if ((LEGACY_MONEY_METADATA_KEYS as readonly string[]).includes(key)) {
      continue
    }
    for (const canonical of LEGACY_MONEY_METADATA_KEYS) {
      const d = distance(key.toLowerCase(), canonical)
      /**
       * Up to 3 edits: a misspelling, not a different word. `design_quantites`
       * is 1 away, `design_quantity` (singular) is 3, and `notes` is nowhere
       * near anything.
       *
       * ⚠️ `d === 0` counts too. The exact-match check above already let the
       * canonical keys through, so reaching here with distance 0 means the key
       * differs only in CASE — and `metadata` lookups are case-sensitive, so
       * `Design_Quantities` is read by nothing. That is a typo wearing a
       * disguise, and the most confusing kind to debug.
       */
      if (d <= 3) {
        return { key, meant: canonical }
      }
    }
  }
  return null
}

/**
 * Refuse a request whose `metadata` misspells a money key.
 *
 * Throws rather than warns: the whole point is that the mistake is otherwise
 * silent and shows up as an underpayment weeks later. A 400 naming the intended
 * key costs the caller one minute; the alternative cost ₹850 for nine garments.
 */
export const assertNoNearMissMoneyKey = (
  metadata: Record<string, unknown> | null | undefined
): void => {
  const miss = nearMissMoneyKey(metadata)
  if (miss) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `metadata.${miss.key} is not a recognised field — did you mean "${miss.meant}"? A misspelt money key is accepted silently and then ignored, which bills the wrong amount. Prefer the typed fields (quantities / unit_amounts / cost_overrides / task_cost_overrides).`
    )
  }
}

/**
 * Mirror the typed fields onto `metadata` for READERS, not for the workflow.
 *
 * ⚠️ This used to be load-bearing: the workflow read the money only off
 * `metadata`, so folding was what made a typed field take effect at all. It no
 * longer is — the workflow reads the typed input and treats metadata as a
 * fallback (see `moneyOf` in create-payment-submission.ts).
 *
 * The fold is kept because the stored submission's `metadata` is what the
 * review UI and existing consumers read to show "original vs. requested". A
 * caller that sends nothing gets exactly the old behaviour, byte for byte.
 *
 * 🔑 Precedence is per-FIELD and one-way: an explicit field replaces the whole
 * corresponding map, never a per-key merge — a caller that sends `quantities`
 * must not still be overridden key-by-key by a stale blob it never wrote.
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
