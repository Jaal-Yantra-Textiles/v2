import { model } from "@medusajs/framework/utils"
import PaymentSubmissionItem from "./payment_submission_item"

const PaymentSubmission = model.define("payment_submission", {
  id: model.id().primaryKey(),
  partner_id: model.text(),
  status: model
    .enum(["Draft", "Pending", "Under_Review", "Approved", "Rejected", "Paid"])
    .default("Draft"),
  total_amount: model.bigNumber(),
  currency: model.text().default("inr"),
  submitted_at: model.dateTime().nullable(),
  reviewed_at: model.dateTime().nullable(),
  reviewed_by: model.text().nullable(),
  /**
   * When money actually moved — as distinct from `status: "Paid"`, which
   * approval sets before anything has demonstrably been sent (#1636 Q4).
   *
   * There is deliberately no `payment_type` column beside it: the payout's
   * type is `internal_payment_details.type` on the linked method, and a second
   * copy is a second thing to disagree with.
   */
  paid_at: model.dateTime().nullable(),
  rejection_reason: model.text().nullable(),
  notes: model.text().nullable(),
  documents: model.json().nullable(), // [{ id, url, filename, mimeType }] — partner bills/invoices
  metadata: model.json().nullable(),
  items: model.hasMany(() => PaymentSubmissionItem, {
    mappedBy: "submission",
  }),
})

export default PaymentSubmission
