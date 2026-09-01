import { model } from "@medusajs/framework/utils"

/**
 * Money a partner has ALREADY been given that no payout consumed (#1712).
 *
 * ## Why this record has to exist
 *
 * hrhandloom was paid INR 30,000 against a payout worth 28,620. The ledger
 * reports `paid: 28,670` and `recorded: 0` — the surplus **1,380 is visible
 * nowhere at all**, because `foldPartnerLedger` clamps `settled_amount` to the
 * payout's own value (`Math.min(settledRaw, submissionAmount)`) and a payment
 * attached to a payout stops being a standalone `recorded` row. The money left
 * the bank and then fell out of every screen.
 *
 * 🔑 A fact no surface holds is a fact that will be paid twice. The 1,380 lived
 * only in a chat transcript until this model existed.
 *
 * ## Why it is not netted automatically
 *
 * `status` starts `Open` and is DISPLAYED, never subtracted. Applying a credit
 * is a deliberate act that reduces a specific future claim and stamps
 * `applied_to_submission_id`. This is the same rule `recorded_against_open`
 * follows and for the same reason: whether money already given discharges the
 * next payout is a decision a human makes, not one a fold may infer.
 *
 * 🔴 And there is a concrete trap it avoids. The obvious way to carry an
 * overpayment forward is to re-link the spare payment to the next payout — but
 * `paid` sums `settled_amount` PER PAYOUT with only a per-payout clamp, so one
 * payment linked to two payouts is counted in full against BOTH. Applying the
 * credit in the claim amount cannot double-count; re-linking can.
 *
 * ⚠️ `amount` is a `bigNumber`, never an integer column. An integer column is
 * what rounded 11.8 to 12 across seven receipts in #1613, and a credit is
 * exactly the kind of small residue that arrives fractional.
 */
const PartnerCredit = model.define("partner_credit", {
  id: model.id().primaryKey(),
  amount: model.bigNumber(),
  currency_code: model.text().default("inr"),

  status: model
    .enum(["Open", "Applied", "Cancelled"])
    .default("Open"),

  /**
   * Where the money came from. `overpayment` is the case that forced this
   * model into existence; the others exist so a credit never has to be
   * mislabelled to be recorded.
   */
  source_type: model
    .enum(["overpayment", "adjustment", "goodwill"])
    .default("overpayment"),

  /**
   * 🔑 Why this credit exists, in words, REQUIRED. A bare amount with no
   * statement of origin is the shape that made `metadata` blobs decide payouts
   * (#1557) — the next reader must be able to audit it without this session's
   * transcript.
   */
  reason: model.text(),

  /** The payout that was overpaid, when the credit arose from one. */
  source_submission_id: model.text().nullable(),

  /** The payout that consumed it. Set together with `applied_at`. */
  applied_to_submission_id: model.text().nullable(),
  applied_at: model.dateTime().nullable(),

  metadata: model.json().nullable(),
})

export default PartnerCredit
