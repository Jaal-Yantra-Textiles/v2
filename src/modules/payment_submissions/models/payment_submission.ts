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
  rejection_reason: model.text().nullable(),
  notes: model.text().nullable(),
  documents: model.json().nullable(), // [{ id, url, filename, mimeType }] — partner bills/invoices
  metadata: model.json().nullable(),
  items: model.hasMany(() => PaymentSubmissionItem, {
    mappedBy: "submission",
  }),
})

export default PaymentSubmission
