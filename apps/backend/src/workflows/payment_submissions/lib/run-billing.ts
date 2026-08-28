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
  quantity: number
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

    for (const runId of (item.production_run_ids || []) as string[]) {
      // First writer wins, so the reported claim is the earliest live one.
      if (!billedRuns.has(runId)) {
        billedRuns.set(runId, {
          submission_id: submissionId,
          status,
          quantity: Number(item.quantity ?? 1),
        })
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
export type RunBillingStatus = "billed" | "unknown" | "clear"

export const runBillingStatus = (input: {
  billed: unknown
  unrecordedClaims: unknown[]
}): RunBillingStatus =>
  input.billed ? "billed" : input.unrecordedClaims?.length ? "unknown" : "clear"
