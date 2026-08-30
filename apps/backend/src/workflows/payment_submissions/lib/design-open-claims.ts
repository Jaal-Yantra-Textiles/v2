/**
 * When does another OPEN submission on the same design still block this one?
 *
 * ## What this guard used to be
 *
 * "Is this design in a Pending/Under_Review submission? Then refuse." A design
 * is produced many times, so that question was always a coarse proxy for the
 * one that matters — *has this work already been claimed?* — and #1596 made the
 * proxy actively wrong: a run is claimed by QUANTITY now. A partner who
 * finishes 4 of a run ordered for 9, bills those 4, and comes back for the rest
 * is doing exactly what that change exists to allow, and this guard refused it
 * on the strength of the design alone.
 *
 * ## What replaces it
 *
 * The run-level guard (`assessRunClaims`) already answers the money question
 * properly: partner-scoped, quantity-aware, blind to nothing — and it refuses
 * on EVERY unattributable case (a claim that names several runs, a line with no
 * usable quantity, a run whose ordered quantity cannot be read). So wherever
 * that guard has the arithmetic, this one adds nothing but a false refusal.
 *
 * 🔴 It has the arithmetic in exactly one situation, and this function's whole
 * job is to recognise it:
 *
 *   - this submission names production runs for the design, AND
 *   - every open prior line for that design names production runs too.
 *
 * The second half is not a formality. `assessRunClaims` diffs against the
 * tallies of lines that NAME runs; a live line that names none is invisible to
 * it. Such a line pays for run work while recording no evidence of which work
 * (`run_provenance: "not_recorded"` — the rows #1557/#1565 were about), so what
 * it already took cannot be subtracted from anything. That is DOUBT, and doubt
 * has to keep refusing.
 *
 * 🔑 Absence of evidence is the one thing this module must never read as room
 * to bill. So the default here is to BLOCK: a design stops blocking only when
 * the runs are on the record, on both sides.
 */

export type OpenPriorLine = {
  design_id: string | null
  submission_id: string | null
  submission_status: string | null
  production_run_ids?: string[] | null
}

export type DesignOpenClaim = {
  design_id: string
  submission_ids: string[]
  /** Why it still blocks, for the refusal message. */
  reason: "no_runs_claimed" | "prior_claim_names_no_runs"
}

const namesRuns = (ids?: string[] | null): boolean =>
  Array.isArray(ids) && ids.filter(Boolean).length > 0

/**
 * PURE. Which of these designs are still blocked by an open prior submission.
 *
 * `openSubmissionsByDesign` is what the caller already knows from the
 * design↔submission link: design id → the open submissions on it, this
 * submission's own excluded. It is kept as the source of "is something open"
 * rather than being re-derived from the lines, because an open submission whose
 * lines we cannot see must still block — inferring "no lines, therefore no
 * claim" is the same absence-as-permission mistake in a new place.
 */
export const designsBlockedByOpenClaims = (input: {
  design_ids: string[]
  /** design id → run ids THIS submission claims for it. */
  claimed_runs: Record<string, string[]> | null | undefined
  /** design id → open submission ids, excluding this submission. */
  open_submissions_by_design: Map<string, string[]>
  /** Every prior line for these designs, this submission's own excluded. */
  prior_lines: OpenPriorLine[]
}): DesignOpenClaim[] => {
  const blocked: DesignOpenClaim[] = []

  // submission id → whether ANY of its lines for the design names a run.
  const linesBySubmission = new Map<string, OpenPriorLine[]>()
  for (const line of input.prior_lines || []) {
    const submissionId = String(line.submission_id || "")
    if (!submissionId) {
      continue
    }
    linesBySubmission.set(submissionId, [
      ...(linesBySubmission.get(submissionId) || []),
      line,
    ])
  }

  for (const designId of input.design_ids || []) {
    const openIds = input.open_submissions_by_design.get(String(designId)) || []
    if (!openIds.length) {
      continue
    }

    const claimedHere = (input.claimed_runs || {})[String(designId)] || []
    if (!namesRuns(claimedHere)) {
      // Nothing to diff on our side: the run guard will not even run for this
      // design, so the old whole-design refusal is the only thing standing.
      blocked.push({
        design_id: String(designId),
        submission_ids: openIds,
        reason: "no_runs_claimed",
      })
      continue
    }

    const opaque = openIds.filter((submissionId) => {
      const lines = (linesBySubmission.get(submissionId) || []).filter(
        (l) => String(l.design_id || "") === String(designId)
      )
      // No visible lines at all ⇒ opaque. Never treat "we saw nothing" as
      // "there is nothing".
      if (!lines.length) {
        return true
      }
      return lines.some((l) => !namesRuns(l.production_run_ids))
    })

    if (opaque.length) {
      blocked.push({
        design_id: String(designId),
        submission_ids: opaque,
        reason: "prior_claim_names_no_runs",
      })
    }
  }

  return blocked
}

/** The refusal, saying what would make it go away. */
export const designOpenClaimsMessage = (
  blocked: DesignOpenClaim[]
): string => {
  const detail = blocked
    .map(({ design_id, submission_ids, reason }) => {
      const holders = submission_ids.join(", ") || "unknown"
      return reason === "no_runs_claimed"
        ? `${design_id} (open in ${holders}; name the production runs this line pays for so the two claims can be told apart)`
        : `${design_id} (open in ${holders}, which does not say which runs it pays for, so this claim cannot be diffed against it)`
    })
    .join("; ")

  return `Designs already in an active payment submission: ${detail}`
}
