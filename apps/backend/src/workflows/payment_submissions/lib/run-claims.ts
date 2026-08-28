/**
 * Who already claimed a production run — scoped by PARTNER, not by design.
 *
 * ## Why this exists
 *
 * Four separate guards answer "is this run already paid for", and every one of
 * them fetched the prior lines the same way:
 *
 *     listPaymentSubmissionItems({ design_id: designIds }, …)
 *
 * — `create-payment-submission` step 6, `submit-payment-submission`,
 * `update-payment-submission-item`, and both `payable-runs` routes.
 *
 * The justification was written down in step 6 and was true when it was
 * written: *"a run belongs to exactly one design, so a prior billing of it can
 * only live on a line for that design."*
 *
 * 🔴 That stops being true the moment a line can be sourced from something
 * other than a design. A run-sourced line carries `design_id: null` — it is
 * keyed by the runs it pays for — so a `design_id`-scoped query CANNOT SEE IT.
 * A design-sourced claim of a run that a run-sourced line already paid for
 * would find no prior, and bill it a second time. The guard would not fire, log,
 * or fail; it would simply be looking somewhere the claim isn't.
 *
 * This is the same shape as every other absence-read-as-permission bug in this
 * module (#1557, #1565): the query returned nothing, and nothing was taken to
 * mean nobody.
 *
 * ## Why partner scope is the right replacement
 *
 * A run belongs to exactly one PARTNER — `production_run.partner_id`, the field
 * the ownership guard already checks — and a submission is for exactly one
 * partner. So a prior billing of a run can only live on a line of a submission
 * for that run's partner. That is just as exact as the design claim was, just
 * as bounded (one partner's submissions, not the whole table), and it holds no
 * matter what a line is sourced FROM.
 *
 * 🔑 Scope by the thing the run actually belongs to, not by the thing the line
 * happens to be keyed on today.
 */

export type PriorRunLine = {
  submission_id: string | null
  submission_status: string | null
  production_run_ids: string[] | null
}

export type RunClaim = {
  /** The submission holding the live claim. */
  submission_id: string | null
  submission_status: string | null
}

/**
 * PURE: fold prior lines into `run id → the claim on it`.
 *
 * A `Rejected` submission never paid anyone, so its lines release their runs
 * and it is skipped — the same rule the design-scoped guards already applied.
 *
 * ⚠️ Unlike the runless guard, `Draft` is NOT exempt here. That exemption
 * exists so a partner can hand-submit the auto-draft they were given, which is
 * a claim naming NO runs. A claim that names a run a Draft already holds is a
 * different thing, and the run-level guard has always refused it.
 *
 * First writer wins, so the reported submission is the earliest live claim
 * rather than an arbitrary one.
 */
export function foldRunClaims(
  priorLines: PriorRunLine[]
): Map<string, RunClaim> {
  const claims = new Map<string, RunClaim>()

  for (const line of priorLines || []) {
    if (String(line.submission_status || "") === "Rejected") continue

    for (const runId of line.production_run_ids || []) {
      if (!runId || claims.has(runId)) continue
      claims.set(runId, {
        submission_id: line.submission_id,
        submission_status: line.submission_status,
      })
    }
  }

  return claims
}

/**
 * Every prior submission line belonging to one partner, in the shape
 * `foldRunClaims` wants.
 *
 * Two queries rather than one because the partner lives on the SUBMISSION and
 * the runs live on the ITEM: resolve the partner's submissions first, then the
 * lines under them. An `excludeSubmissionId` drops the submission being edited,
 * so a line does not read its own claim as a conflict with itself.
 */
export async function listPartnerRunClaims(
  service: {
    listPaymentSubmissions: (filters: any, config?: any) => Promise<any[]>
    listPaymentSubmissionItems: (filters: any, config?: any) => Promise<any[]>
  },
  partnerId: string,
  options?: { excludeSubmissionId?: string }
): Promise<Map<string, RunClaim>> {
  if (!partnerId) return new Map()

  const submissions = await service.listPaymentSubmissions({
    partner_id: partnerId,
  })

  const submissionIds = (submissions || [])
    .map((s: any) => s?.id)
    .filter(
      (id: string) => !!id && id !== options?.excludeSubmissionId
    )

  if (!submissionIds.length) return new Map()

  const items = await service.listPaymentSubmissionItems(
    { submission_id: submissionIds },
    { relations: ["submission"] }
  )

  return foldRunClaims(
    ((items || []) as any[]).map((item) => ({
      submission_id: item.submission?.id ?? item.submission_id ?? null,
      submission_status: item.submission?.status ?? null,
      production_run_ids: (item.production_run_ids || []) as string[],
    }))
  )
}

/** The refusal, naming who holds each run. */
export function runsAlreadyClaimedMessage(
  duplicates: string[],
  claims: Map<string, RunClaim>
): string {
  const parts = duplicates.map((id) => {
    const claim = claims.get(id)
    const status = claim?.submission_status ? `, ${claim.submission_status}` : ""
    return `${id} (submission ${claim?.submission_id ?? "unknown"}${status})`
  })

  return `Production runs already paid for: ${parts.join(", ")}`
}
