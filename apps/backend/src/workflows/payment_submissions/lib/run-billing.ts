/**
 * Whether a completed run has already been paid for — folded ONCE (#1622).
 *
 * 🔴 This loop was inline in `payable-runs`, which is the only screen that has
 * ever known the answer. #1622 puts the same question on the run itself, and a
 * second implementation of "is this run billed" is how two screens start
 * disagreeing about whether someone gets paid twice. The rules — a Rejected
 * submission releases its runs, first live claim wins, a `not_recorded` line is
 * DOUBT rather than a clearance — are stated here and nowhere else.
 *
 * See `run-claims.ts` for why the scope is the PARTNER: a run-sourced line
 * carries `design_id: null`, so a design-scoped query cannot see it.
 */

export type PartnerLineLike = {
  submission_id?: string | null
  submission?: { id?: string | null; status?: string | null } | null
  design_id?: string | null
  amount?: number | string | null
  quantity?: number | string | null
  run_provenance?: string | null
  production_run_ids?: string[] | null
}

export type RunBillingClaim = {
  submission_id: string
  status: string
  /** Units the EARLIEST live line claimed — kept for display, as before. */
  quantity: number
  /**
   * Units claimed across EVERY live line naming this run (#1596). A run is
   * claimed by quantity now, so "is it billed" has stopped being a yes/no —
   * `01M0Y336X9A6DJ9ESZ4HC0RXVM`'s run was ordered for 9 and billed for 7.
   */
  claimed_quantity: number
  /**
   * A live line claims this run without an attributable quantity — it names
   * several runs (their quantities are summed into one figure) or states none.
   * Such a claim takes the run entirely, and no remainder can be offered.
   */
  claimed_wholly: boolean
}

export type UnrecordedClaim = {
  submission_id: string
  status: string
  amount: number
}

/** Statuses where a payout is still in flight rather than settled. */
const OPEN_STATUSES = new Set(["Draft", "Pending", "Under_Review"])

export type PartnerBilling = {
  /** run id → the earliest live line naming it. */
  billedRuns: Map<string, RunBillingClaim>
  /**
   * Designs carrying a live payout that does not say which run it paid for.
   *
   * 🔴 These are the rows that made the guard a fiction. A line with
   * `run_provenance: "not_recorded"` pays for run work, is not Rejected, and
   * names no run — so for every completed run of that design, "is this already
   * paid for?" has no answer. Reporting it as unbilled says "no", which is how
   * the same garments get paid for twice.
   *
   * A `no_run` line (a task payout) is deliberately NOT collected: that is the
   * one case where a missing run is an answer rather than a gap.
   */
  designsWithUnrecordedClaims: Map<string, UnrecordedClaim[]>
  designsWithOpenSubmission: Set<string>
}

/** PURE: fold one partner's prior submission lines into what they claim. */
export const foldPartnerBilling = (
  priorItems: PartnerLineLike[]
): PartnerBilling => {
  const billedRuns = new Map<string, RunBillingClaim>()
  const designsWithOpenSubmission = new Set<string>()
  const designsWithUnrecordedClaims = new Map<string, UnrecordedClaim[]>()

  for (const item of priorItems || []) {
    const status = String(item.submission?.status || "")
    // A Rejected submission never paid anyone — its lines release their runs.
    if (status === "Rejected") continue

    const submissionId = String(item.submission?.id || item.submission_id || "")

    if (OPEN_STATUSES.has(status) && item.design_id) {
      designsWithOpenSubmission.add(String(item.design_id))
    }

    if (item.run_provenance === "not_recorded" && item.design_id) {
      const designId = String(item.design_id)
      const claims = designsWithUnrecordedClaims.get(designId) || []
      claims.push({
        submission_id: submissionId,
        status,
        amount: Number(item.amount ?? 0),
      })
      designsWithUnrecordedClaims.set(designId, claims)
    }

    const runIds = ((item.production_run_ids || []) as string[]).filter(Boolean)
    const lineQuantity = Number(item.quantity)
    /**
     * Attributable only when the line names exactly ONE run and states a usable
     * quantity — the same rule the write guard uses (`lib/run-claims`), stated
     * once per side so the screen and the refusal cannot disagree about how
     * much of a run is left.
     */
    const attributable =
      runIds.length === 1 && Number.isFinite(lineQuantity) && lineQuantity > 0

    for (const runId of runIds) {
      const existing = billedRuns.get(runId)

      if (!existing) {
        // First writer wins for the DISPLAYED claim, as before.
        billedRuns.set(runId, {
          submission_id: submissionId,
          status,
          quantity: Number(item.quantity ?? 1),
          claimed_quantity: attributable ? lineQuantity : 0,
          claimed_wholly: !attributable,
        })
        continue
      }

      if (attributable) {
        existing.claimed_quantity += lineQuantity
      } else {
        existing.claimed_wholly = true
      }
    }
  }

  return { billedRuns, designsWithUnrecordedClaims, designsWithOpenSubmission }
}

/**
 * The single field a caller should branch on, so that "we don't know" cannot be
 * spelled the same way as "no".
 *
 * - `billed`  — a payment line names this run. Do not pay again.
 * - `unknown` — a live payout for this design records no run, so this run may
 *               already be inside it. Needs a human before it is paid; #1565 is
 *               the whole reason this value exists.
 * - `clear`   — every live payout for this design says which runs it covered,
 *               and none of them is this one. Safe to bill.
 */
export type RunBillingStatus =
  | "billed"
  | "partly_billed"
  | "unknown"
  | "clear"

/**
 * PURE: how many units of a run are still billable, or null when that cannot
 * be answered.
 *
 * Null — not 0, and not the ordered quantity — whenever the arithmetic is
 * unavailable: nobody has claimed it (there is no remainder to speak of), a
 * claim took the run whole, or the run states no quantity to divide. A number
 * here is a promise the write guard will honour, so it must not be guessed;
 * `assessRunClaims` refuses in exactly the same three cases.
 */
export const runBillableRemaining = (input: {
  claim: RunBillingClaim | null | undefined
  /**
   * The run's BILLABLE CEILING — `runBillableCeiling(run)`, which is the
   * ordered quantity until the run is short-closed and the produced quantity
   * after (#1596). It must be the same number `assessRunClaims` compares
   * against: a screen offering units the write guard will refuse is the defect
   * this field exists to prevent.
   */
  ordered: number | string | null | undefined
}): number | null => {
  const claim = input.claim
  if (!claim || claim.claimed_wholly) {
    return null
  }

  const ceiling = Number(input.ordered)
  if (!Number.isFinite(ceiling) || ceiling <= 0) {
    return null
  }

  // Clamped at zero on purpose. A run short-closed BELOW what was already
  // legitimately billed leaves no remainder and no clawback — a negative here
  // would read as a debt somebody owes back.
  return Math.max(0, ceiling - claim.claimed_quantity)
}

/**
 * The single field a caller should branch on, so that "we don't know" cannot be
 * spelled the same way as "no".
 *
 * - `billed`        — this run is claimed in full. Do not pay again.
 * - `partly_billed` — a line claims SOME of it and units remain (#1596). The
 *                     write guard will accept the remainder, so the screen has
 *                     to offer it; reporting this as `billed` is what left the
 *                     jacket run's last 2 units unbillable through any UI.
 * - `unknown`       — a live payout for this design records no run, so this run
 *                     may already be inside it. Needs a human before it is
 *                     paid; #1565 is the whole reason this value exists.
 * - `clear`         — every live payout for this design says which runs it
 *                     covered, and none of them is this one. Safe to bill.
 */
export const runBillingStatus = (input: {
  billed: unknown
  unrecordedClaims: unknown[]
  /** Units still billable, from `runBillableRemaining`. */
  remaining?: number | null
  /**
   * The run states NO agreed quantity — `isOpenEndedRun` (#1676).
   *
   * 🔴 Load-bearing, and easy to leave out. `runBillableRemaining` returns
   * `null` for such a run because there is no ceiling to subtract from, and
   * `null` here otherwise reads as "nothing left" — so a run that may be billed
   * again indefinitely would report `billed`, and every screen would stop
   * offering it after ONE claim. That is the whole feature, undone by a null
   * meaning two things.
   */
  openEnded?: boolean
}): RunBillingStatus => {
  if (input.billed) {
    if (input.openEnded) {
      // More may always be billed; how much is deliberately unbounded, which
      // is why `billable_remaining` stays null beside this.
      return "partly_billed"
    }
    return input.remaining != null && input.remaining > 0
      ? "partly_billed"
      : "billed"
  }
  return input.unrecordedClaims?.length ? "unknown" : "clear"
}
