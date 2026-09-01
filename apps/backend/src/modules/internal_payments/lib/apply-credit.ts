/**
 * Whether a credit may discharge a given payout, and by how much (#1712).
 *
 * PURE, and the ONE home for that arithmetic. The admin route asks it before
 * writing, and `foldPartnerLedger` asks it again when reporting — two surfaces
 * deciding for themselves how much of a payout a credit consumes is exactly how
 * `foldPartnerBilling` ended up with a private copy in `partner-ui` and the
 * run-line pricer ended up with two homes.
 *
 * ## Why applying is a write and not a fold
 *
 * `recorded_against` is advisory precisely because a shared order id is not a
 * statement that money discharges a claim. A credit is the opposite: a human
 * naming the payout it consumes. So unlike `recorded_against`, an applied
 * credit DOES enter the arithmetic — it is the decision itself, not evidence
 * that someone should make one.
 *
 * ## Why it refuses instead of clamping
 *
 * 🔴 A silent clamp is what hid the 1,380 in the first place. `foldPartnerLedger`
 * caps `settled_amount` at the payout's own value, so 30,000 paid against a
 * 28,620 payout reported 28,620 and the surplus fell out of every screen. If
 * applying a 5,000 credit to a 1,000 remainder quietly consumed 1,000 and threw
 * the rest away, this model would reintroduce the same defect one level up —
 * and `partner_credit` has no `applied_amount` column to hold the difference,
 * so a partial application cannot even be recorded. It refuses, and names both
 * numbers.
 */

export type CreditForApply = {
  amount?: number | string | null
  status?: string | null
  currency_code?: string | null
}

export type SubmissionForApply = {
  total_amount?: number | string | null
  status?: string | null
  currency?: string | null
}

export type ApplyRefusal = {
  code:
    | "credit_not_open"
    | "submission_rejected"
    | "submission_paid"
    | "currency_mismatch"
    | "exceeds_remaining"
  message: string
}

export type ApplyVerdict =
  | { ok: true; remaining_before: number; remaining_after: number }
  | { ok: false; remaining_before: number; refusal: ApplyRefusal }

const num = (v: unknown): number => {
  const n = Number(v ?? 0)
  return Number.isFinite(n) ? n : 0
}

const round2 = (n: number): number => Math.round(n * 100) / 100

/**
 * What is still claimable on a payout once money already settled against it and
 * credits already applied to it are taken off.
 *
 * ⚠️ Floored at 0. A payout that is somehow over-settled is a fact for the
 * ledger to show, not a negative headroom that would let a credit be applied
 * to create one.
 */
export const remainingClaim = (input: {
  submissionAmount: number | string | null | undefined
  settledAmount?: number | string | null
  appliedCreditsTotal?: number | string | null
}): number =>
  round2(
    Math.max(
      0,
      num(input.submissionAmount) -
        num(input.settledAmount) -
        num(input.appliedCreditsTotal)
    )
  )

/**
 * The statuses a payout can be in and still have something left to discharge.
 *
 * ⚠️ `Paid` is excluded, and that is not the same rule as `PAID_STATUSES` in
 * the ledger fold being about arithmetic. Here it is about meaning: a payout
 * marked Paid asserts the whole amount moved, so applying a credit to it would
 * claim the partner was given the money twice — once in the transfer and once
 * as a credit that no longer reduces anything.
 *
 * `Rejected` is excluded because a rejected claim owes nothing; consuming a
 * credit against it would destroy money the partner still holds.
 */
export const canApplyToStatus = (status: string | null | undefined): boolean =>
  String(status ?? "") !== "Paid" && String(status ?? "") !== "Rejected"

export const checkCreditApplicable = (input: {
  credit: CreditForApply
  submission: SubmissionForApply
  settledAmount?: number | string | null
  appliedCreditsTotal?: number | string | null
}): ApplyVerdict => {
  const { credit, submission } = input
  const amount = num(credit.amount)
  const remaining_before = remainingClaim({
    submissionAmount: submission.total_amount,
    settledAmount: input.settledAmount,
    appliedCreditsTotal: input.appliedCreditsTotal,
  })

  const refuse = (
    code: ApplyRefusal["code"],
    message: string
  ): ApplyVerdict => ({ ok: false, remaining_before, refusal: { code, message } })

  if (String(credit.status ?? "") !== "Open") {
    return refuse(
      "credit_not_open",
      `this credit is ${credit.status ?? "unknown"}, not Open — only an Open credit has money left to apply`
    )
  }

  if (String(submission.status ?? "") === "Rejected") {
    return refuse(
      "submission_rejected",
      "that payout is Rejected — it owes nothing, and applying a credit to it would consume money the partner still holds"
    )
  }

  if (String(submission.status ?? "") === "Paid") {
    return refuse(
      "submission_paid",
      "that payout is already Paid in full — applying a credit to it would claim the partner was given the same money twice"
    )
  }

  /**
   * ⚠️ Compared case-insensitively and only when BOTH sides state one. A
   * missing currency is not evidence of a mismatch, and refusing on it would
   * block every historical row that predates the column.
   */
  const cc = String(credit.currency_code ?? "").toLowerCase()
  const sc = String(submission.currency ?? "").toLowerCase()
  if (cc && sc && cc !== sc) {
    return refuse(
      "currency_mismatch",
      `credit is in ${cc.toUpperCase()} and the payout is in ${sc.toUpperCase()} — this fold holds no exchange rate and must not invent one`
    )
  }

  if (amount > remaining_before) {
    return refuse(
      "exceeds_remaining",
      `credit of ${amount} is larger than the ${remaining_before} still claimable on that payout. A credit applies whole — there is no applied_amount column to hold a remainder — so split the credit or pick a payout it fits`
    )
  }

  return {
    ok: true,
    remaining_before,
    remaining_after: round2(remaining_before - amount),
  }
}

/**
 * The credits a payout has consumed, summed.
 *
 * 🔑 Only `Applied` rows, and only those naming THIS payout. An `Open` credit
 * has discharged nothing and a `Cancelled` one never will — counting either
 * would report a payout as smaller than it is and underpay the partner.
 */
export const appliedCreditsFor = (
  submissionId: string,
  credits: Array<{
    id?: string
    amount?: number | string | null
    status?: string | null
    applied_to_submission_id?: string | null
  }> | null | undefined
): { total: number; ids: string[] } => {
  const rows = (credits || []).filter(
    (c) =>
      String(c?.status ?? "") === "Applied" &&
      String(c?.applied_to_submission_id ?? "") === submissionId
  )
  return {
    total: round2(rows.reduce((acc, c) => acc + num(c.amount), 0)),
    ids: rows.map((c) => String(c.id ?? "")).filter(Boolean),
  }
}
