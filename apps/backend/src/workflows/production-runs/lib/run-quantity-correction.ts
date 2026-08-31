import type { RunClaimTally } from "../../payment_submissions/lib/run-claims"
import { runBillableCeiling } from "../../payment_submissions/lib/run-billable-ceiling"

/**
 * May a run's agreed quantity still be corrected — and what does the correction
 * make claimable? (#1695)
 *
 * ## The freeze point was in the wrong place
 *
 * `POST /admin/production-runs/:id` froze quantity at `accepted_at` /
 * `started_at`, inherited from #1676, which was solving a different problem: an
 * UNBOUNDED first claim. It bounded the claim by freezing the field.
 *
 * 🔴 The two halves then deadlock. A run sent for 2 where the partner made 3
 * cannot be corrected — the run refuses because work began, and
 * `assessRunClaims` refuses a claim of 3 against a ceiling of 2. Nothing was
 * paid, nothing was disputed, and the system still could not represent what had
 * happened. It took an ops job (#1694) to break it, which is the right escape
 * hatch and the wrong daily mechanism.
 *
 * ## The rule this encodes
 *
 * **Mutable until the derived money is settled.** Not until work starts, not
 * until it completes. Payment is the event that turns a number from a current
 * belief into a historical fact — which is the freeze point the consumption
 * route already uses (`inventory_applied_at`, #1693) and got right.
 *
 * So: correctable while every live claim against the run is a `Draft`. One
 * `Pending`, `Under_Review`, `Approved` or `Paid` claim and the ceiling is
 * load-bearing for money somebody is acting on — past that point a correction
 * is a reversing entry, not an edit.
 *
 * `Rejected` never paid anyone and is already dropped upstream by
 * `foldRunClaimTallies`, so it does not freeze anything.
 *
 * ## 🔴 Lowering is not the mirror of raising
 *
 * Raising is additive: it makes units newly claimable and invalidates nothing.
 * Lowering drops the ceiling under claims already made, turning valid
 * submissions into retroactive overclaims with no mechanism to notice. Same
 * refusal the ops job makes, for the same reason.
 *
 * And when a claim is unattributable — a line naming several runs carries their
 * SUM — there is no number to compare against, so a lowering cannot be PROVEN
 * safe. Refuse; do not assume zero. Absence is never permission (#1557, #1565).
 */

export type CorrectionClaim = {
  submission_id: string | null
  submission_status: string | null
}

export type RunQuantityCorrection = {
  allowed: boolean
  /** Written for the caller of the API, not for a log. Null when allowed. */
  refusal: string | null
  /** Units already claimed and attributable to this run. */
  claimed_quantity: number
  /** A live claim covers the run without an attributable quantity. */
  claimed_wholly: boolean
  /** The claims that FREEZE the run — non-Draft. Empty when nothing is frozen. */
  frozen_by: CorrectionClaim[]
  /** Ceiling before and after, and what the change opens up. */
  ceiling_before: number | null
  ceiling_after: number | null
  /** Units that become billable that were not. Null when either end is open. */
  newly_claimable: number | null
  /** `newly_claimable` at the run's own per-unit rate, when it has one. */
  worth: number | null
}

/** Everything except `Draft` is a live claim on money somebody is acting on. */
const freezesTheRun = (status: string | null | undefined): boolean =>
  String(status ?? "") !== "Draft"

type RunLike = {
  quantity?: number | string | null
  produced_quantity?: number | string | null
  short_closed_at?: Date | string | null
  cost_type?: string | null
  partner_cost_estimate?: number | string | null
}

/**
 * PURE.
 *
 * `next_quantity` is the requested agreed quantity: a number, or `null` for an
 * open-ended run (#1676's opt-out — no ceiling at all).
 *
 * `claims_readable: false` means the claim lookup FAILED. It is not the same as
 * "no claims", and it refuses every change rather than letting an outage read
 * as headroom.
 */
export function assessRunQuantityCorrection(input: {
  run: RunLike
  next_quantity: number | null
  tally?: RunClaimTally | null
  claims_readable: boolean
}): RunQuantityCorrection {
  const { run, next_quantity, tally } = input

  const claimed = Number(tally?.claimed_quantity ?? 0)
  const claimedWholly = Boolean(tally?.claimed_wholly)
  const frozenBy = (tally?.claims ?? []).filter((c) =>
    freezesTheRun(c.submission_status)
  )

  const ceilingBefore = runBillableCeiling(run)
  const ceilingAfter = runBillableCeiling({ ...run, quantity: next_quantity })

  const newlyClaimable =
    ceilingBefore === null || ceilingAfter === null
      ? null
      : Math.max(0, ceilingAfter - ceilingBefore)

  const rate = Number(run.partner_cost_estimate ?? 0)
  const perUnit = run.cost_type === "per_unit" && rate > 0 ? rate : null

  const base = {
    claimed_quantity: claimed,
    claimed_wholly: claimedWholly,
    frozen_by: frozenBy,
    ceiling_before: ceilingBefore,
    ceiling_after: ceilingAfter,
    newly_claimable: newlyClaimable,
    worth: newlyClaimable !== null && perUnit ? newlyClaimable * perUnit : null,
  }

  const refuse = (refusal: string): RunQuantityCorrection => ({
    ...base,
    allowed: false,
    refusal,
  })

  if (!input.claims_readable) {
    return refuse(
      "Could not read what has already been claimed against this run — refusing to change a billing ceiling blind."
    )
  }

  if (frozenBy.length) {
    const naming = frozenBy
      .map((c) => `${c.submission_id ?? "unknown"} (${c.submission_status ?? "unknown"})`)
      .join(", ")
    return refuse(
      `Cannot change the quantity: this run is already claimed by a submission that is no longer a draft — ${naming}. Past that point a correction is a reversing entry on the payout, not an edit to the run.`
    )
  }

  // A lowering, measured against what has been claimed. `null` is open-ended,
  // which is never a lowering.
  if (next_quantity !== null) {
    if (claimedWholly) {
      const lowering =
        ceilingBefore === null || ceilingAfter === null
          ? true
          : ceilingAfter < ceilingBefore
      if (lowering) {
        return refuse(
          "Cannot lower the quantity: a draft claim covers this run without an attributable quantity, so a lower ceiling cannot be shown to be safe."
        )
      }
    }
    if (next_quantity < claimed) {
      return refuse(
        `Cannot lower the agreed quantity to ${next_quantity}: ${claimed} has already been claimed against this run, which would become a retroactive overclaim.`
      )
    }
  }

  return { ...base, allowed: true, refusal: null }
}

/**
 * The consequence, in one line, ALWAYS stated — the same discipline the ops job
 * applies. A quantity moving next to money in silence is how a correction
 * becomes a surprise on somebody's payout.
 */
export function correctionConsequenceNote(
  assessment: RunQuantityCorrection
): string {
  if (assessment.ceiling_after === null) {
    return "run becomes OPEN-ENDED — no ceiling on what may be billed against it"
  }

  const claimable =
    assessment.newly_claimable === null
      ? "unknown"
      : String(assessment.newly_claimable)

  const worth =
    assessment.worth !== null && assessment.newly_claimable
      ? ` (worth ${assessment.worth})`
      : ""

  return `ceiling ${assessment.ceiling_before ?? "none"} → ${assessment.ceiling_after}; already claimed ${assessment.claimed_quantity}; newly claimable ${claimable}${worth}`
}
