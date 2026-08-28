/**
 * Which unclaimed Draft payouts no longer match the run they were priced from.
 *
 * ## The gap this closes
 *
 * `refreshUnclaimedDraftPayouts` re-prices a Draft when a run's money is
 * corrected — but it fires from exactly ONE place: the admin production-run
 * PATCH route. So a Draft is only ever re-priced if somebody happens to correct
 * that run through that route, in that session. Nothing sweeps.
 *
 * Every other way a run's figures move leaves the Draft untouched and looking
 * authoritative: a correction made before that route existed, a run edited by
 * an ops job, a `produced_quantity` written by run completion after the draft
 * was raised. There is no event that revisits a Draft, and there is no route
 * that could fix one either — a submission has GET and `review`, and `review`
 * refuses anything that is not Pending or Under_Review.
 *
 * ## The decision is pure, and it is a COMPARISON, not a re-derivation
 *
 * The expected figures come from `assessRunPayout` — the same function the
 * subscriber drafted with and the same one the correction path re-prices with.
 * This file never computes a payout of its own. If it did, a sweep could
 * quietly change the BASIS of a figure (it bills ordered, not produced) and
 * report the difference as a repair.
 */

/** What a Draft line currently says. */
export type DraftPayoutLine = {
  item_id: string
  submission_id: string
  design_id: string | null
  /** The runs this line claims to pay for. */
  production_run_ids: string[]
  run_provenance: string | null
  amount: number | null
  quantity: number | null
  unit_amount: number | null
}

/** What the run says it should say. From `assessRunPayout`, never recomputed. */
export type ExpectedPayout = {
  eligible: boolean
  amount: number
  quantity: number
  unit_amount: number
}

export type StaleDraftVerdict =
  | { verdict: "stale"; reason: string; expected: ExpectedPayout }
  | { verdict: "current" }
  | { verdict: "skipped"; reason: string }

const near = (a: unknown, b: unknown): boolean => {
  const x = Number(a)
  const y = Number(b)
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false
  // Money is stored to 2dp; a bigNumber round-trip can leave a hair of float.
  return Math.abs(x - y) < 0.005
}

/**
 * PURE: does this Draft line still match its run?
 *
 * 🔴 Every ambiguous case is `skipped`, never `stale`. A sweep that repairs on
 * a guess rewrites what somebody is owed, and the whole reason this is a job
 * rather than a subscriber is that a human reads its dry run first.
 */
export function assessDraftLine(
  line: DraftPayoutLine,
  expected: ExpectedPayout
): StaleDraftVerdict {
  /**
   * 🔴 `not_recorded` means "this paid for run work whose run was never
   * written down" — the line cannot be matched to a run at all, so nothing
   * here can say whether it is stale. `production_run_ids` being non-empty is
   * NOT enough on its own: that column meant three different things before
   * `run_provenance` existed, and re-deriving the distinction from it is
   * exactly the ambiguity that column was added to end.
   */
  if (line.run_provenance !== "recorded") {
    return {
      verdict: "skipped",
      reason: `run provenance is "${line.run_provenance ?? "unset"}" — this line cannot be matched to a run, so whether it is stale is unknowable.`,
    }
  }

  if (!line.production_run_ids?.length) {
    return {
      verdict: "skipped",
      reason:
        'line claims "recorded" provenance but names no runs — it cannot back its own claim, so it is left for a human.',
    }
  }

  /**
   * A line can collapse SEVERAL runs of one design into one figure. Re-pricing
   * that from a single run's payout would bill one run's work as though it
   * were all of it — the same class of error as #1554, arrived at from the
   * other direction.
   */
  if (line.production_run_ids.length > 1) {
    return {
      verdict: "skipped",
      reason: `line collapses ${line.production_run_ids.length} runs into one figure; a single run's payout cannot re-price it.`,
    }
  }

  /**
   * 🔴 Not eligible is not "worth zero". A run whose rate was cleared or which
   * was reopened has no payable figure at all, and writing 0 would read as a
   * decision that the work was worthless — the #1564 mistake exactly.
   */
  if (!expected.eligible) {
    return {
      verdict: "skipped",
      reason:
        "the run no longer yields a payable figure (rate cleared, or reopened). Zeroing the draft would claim the work was worthless.",
    }
  }

  const diffs: string[] = []
  if (!near(line.amount, expected.amount)) {
    diffs.push(`amount ${fmt(line.amount)} → ${fmt(expected.amount)}`)
  }
  if (!near(line.quantity, expected.quantity)) {
    diffs.push(`quantity ${fmt(line.quantity)} → ${fmt(expected.quantity)}`)
  }
  if (!near(line.unit_amount, expected.unit_amount)) {
    diffs.push(`unit ${fmt(line.unit_amount)} → ${fmt(expected.unit_amount)}`)
  }

  if (!diffs.length) return { verdict: "current" }

  return {
    verdict: "stale",
    reason: `run ${line.production_run_ids[0]} now says ${diffs.join(", ")}`,
    expected,
  }
}

const fmt = (n: unknown): string =>
  n === null || n === undefined ? "unset" : String(Number(n))

/**
 * PURE: one sentence an operator can act on.
 *
 * ⚠️ Skipped is reported as its own number rather than folded into "examined".
 * A sweep that says "3 of 200 stale" while 150 were unknowable has told the
 * operator the opposite of the truth about its own coverage.
 */
/**
 * 🔴 `stale` is NOT the number of payouts whose money changes, and reporting it
 * as such is a bad INSTRUCTION rather than a bad number.
 *
 * The first real prod dry-run examined 7 lines and said *"5 would be
 * re-priced"*. Four of those five had an identical before and after: their
 * amounts were correct and only the BREAKDOWN was missing — `unit_amount`
 * unset, or a quantity of 1 standing in for 5 × 500. An operator reading
 * "5 re-priced" concludes five artisans are being paid the wrong amount and
 * goes looking for four discrepancies that do not exist. That is the #1559
 * shape exactly: a report-only job's risk is what it tells a human to do.
 *
 * So the two are counted apart. Both are still written — a line that bills
 * 2500 as "1 × unset" instead of "5 × 500" is a line a partner cannot check,
 * and fixing that is the point of the breakdown columns. It is simply not a
 * re-pricing.
 */
export function summarizeDraftSweep(input: {
  examined: number
  stale: number
  /**
   * Of `stale`, how many change the AMOUNT. The remainder only backfill the
   * quantity/rate behind an amount that was already right. Optional so an older
   * caller keeps today's wording rather than silently reporting zero.
   */
  repriced?: number
  current: number
  skipped: number
  dryRun: boolean
}): string {
  const { examined, stale, current, skipped, dryRun } = input

  if (!examined) {
    return "No unclaimed Draft payout lines to examine."
  }

  const verb = dryRun ? "would be re-priced" : "re-priced"
  const backfillVerb = dryRun
    ? "would gain a quantity/rate breakdown with no change to the amount"
    : "gained a quantity/rate breakdown with no change to the amount"

  const repriced = input.repriced === undefined ? stale : input.repriced
  const backfilled = Math.max(0, stale - repriced)

  const parts = [
    `${examined} draft line${examined === 1 ? "" : "s"} examined`,
    `${repriced} ${verb}`,
  ]
  if (backfilled) {
    parts.push(`${backfilled} ${backfillVerb}`)
  }
  parts.push(`${current} already current`)
  if (skipped) {
    parts.push(`${skipped} skipped as unknowable or ambiguous (see changes)`)
  }
  return parts.join(", ") + "."
}
