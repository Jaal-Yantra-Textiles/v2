/**
 * The other half of "already paid for" (#1556).
 *
 * ## The hole
 *
 * `create-payment-submission` has two guards and neither covers this case.
 *
 * The design-level guard asks "is this design in an OPEN submission" —
 * Pending or Under_Review — which stops being true the moment the first payout
 * is Approved or Paid.
 *
 * The run-level guard is the real one: it refuses any run already claimed by a
 * non-Rejected submission, Paid included. But it is gated on
 * `if (allClaimedRunIds.length)` — it only runs when the NEW submission names
 * runs. A submission that names none skips it entirely.
 *
 * So: bill a design, get it Paid, then submit the same design again WITHOUT
 * naming runs. The design guard passes (nothing is open), the run guard never
 * executes (nothing was claimed), and the same work is billed twice. Nothing
 * in the record can tell the two claims apart afterwards, because the second
 * one recorded no evidence of what it was for.
 *
 * ## Why refusing is the right answer, rather than guessing
 *
 * There is no way to compute "unbilled quantity" for a claim that names
 * nothing. The honest position is the one the model already takes: a line
 * whose provenance is not `recorded` must be read as UNKNOWN, never as clear.
 * Paying twice is far harder to undo than a refusal a partner can act on in
 * one step — the create screen has sent `production_run_ids` since #1579, so
 * "name the runs" is a field away, not a support ticket.
 *
 * 🔑 A prior line that says `no_run` does NOT block. That value means "this
 * paid for something no run produced" — it makes no claim on any run, so it
 * cannot be double-claimed by one. Only `recorded` and `not_recorded` describe
 * run work.
 *
 * 🔴 Nor does a prior in **Draft**, and that exemption is load-bearing rather
 * than a nicety.
 *
 * `auto-draft-payment-submission` drafts a submission on every
 * `production_run.completed`, and a Draft is explicitly "visible, editable, and
 * NOT yet a claim on anyone" — nothing is billed without the partner's say-so.
 * The partner then submits by hand, which `create-payment-submission` documents
 * as the intended path: *"A partner submitting by hand is NOT blocked by their
 * own draft — that's them turning the draft into a real submission."*
 *
 * That hand submission cannot name the runs (the Draft already holds a live
 * claim on them, so the run-level guard refuses it), and there is no route that
 * converts a Draft to Pending. So naming NO runs was the only way through — and
 * blocking it here left the design unbillable by any route at all, with the
 * Draft equally unrejectable (review requires Pending/Under_Review) and
 * undeletable (#1604).
 *
 * A Draft has never been submitted, approved or paid, so exempting it costs the
 * guard nothing: its real target is a prior that actually took money —
 * Pending, Under_Review, Approved, Paid. The proper fix is a submit route that
 * converts a Draft in place; until that exists this exemption is what keeps the
 * documented flow working.
 */

export type PriorSubmissionLine = {
  design_id: string | null
  /** The prior submission's status. `Rejected` never paid anyone. */
  submission_status: string | null
  submission_id: string | null
  run_provenance: string | null
}

export type RunlessConflict = {
  design_id: string
  prior_submission_id: string | null
  prior_status: string | null
}

/**
 * PURE: which designs are being re-billed with no run evidence at all.
 *
 * A design is a conflict when the NEW submission names no runs for it AND some
 * prior non-Rejected line for that design claims to have paid for run work.
 */
export function designsBilledWithoutRunEvidence(input: {
  design_ids: string[]
  /** design id → run ids, as the new submission claims them. */
  claimed_runs: Record<string, string[]> | undefined
  prior_lines: PriorSubmissionLine[]
}): RunlessConflict[] {
  const claimed = input.claimed_runs || {}
  const conflicts: RunlessConflict[] = []

  for (const designId of input.design_ids || []) {
    // Named its runs — the run-level guard owns this design and is exact.
    if ((claimed[designId] || []).filter(Boolean).length) continue

    const prior = (input.prior_lines || []).find((line) => {
      if (String(line.design_id || "") !== designId) return false

      /**
       * Neither of these ever took money, so neither stakes a claim a second
       * submission could duplicate:
       *   - `Rejected` — reviewed and refused; its lines release their runs.
       *   - `Draft`    — never submitted at all. See the docblock above: this
       *                  is the auto-draft the partner is in the middle of
       *                  turning into a real submission.
       */
      const priorStatus = String(line.submission_status || "")
      if (priorStatus === "Rejected" || priorStatus === "Draft") return false

      /**
       * 🔑 `no_run` is an explicit statement that no run produced this work, so
       * it stakes no claim a run could duplicate. Everything else does —
       * including the `not_recorded` default, which is the honest reading of a
       * writer that told us nothing.
       */
      return String(line.run_provenance || "not_recorded") !== "no_run"
    })

    if (prior) {
      conflicts.push({
        design_id: designId,
        prior_submission_id: prior.submission_id ?? null,
        prior_status: prior.submission_status ?? null,
      })
    }
  }

  return conflicts
}

/** The refusal, in words a partner can act on. */
export function runlessResubmitMessage(conflicts: RunlessConflict[]): string {
  const parts = conflicts.map(
    (c) =>
      `${c.design_id} (already billed on submission ${c.prior_submission_id ?? "unknown"}${c.prior_status ? `, ${c.prior_status}` : ""})`
  )

  return (
    `These designs have been billed before and this claim names no production runs, ` +
    `so there is no way to tell it apart from the earlier one: ${parts.join(", ")}. ` +
    `Name the runs this submission pays for and resubmit — the payment screen sends them automatically.`
  )
}
