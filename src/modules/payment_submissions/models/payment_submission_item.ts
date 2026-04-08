import { model } from "@medusajs/framework/utils"
import PaymentSubmission from "./payment_submission"

const PaymentSubmissionItem = model.define("payment_submission_item", {
  id: model.id().primaryKey(),
  design_id: model.text(),
  design_name: model.text().nullable(),
  amount: model.bigNumber(),
  cost_breakdown: model.json().nullable(),
  metadata: model.json().nullable(),
  submission: model.belongsTo(() => PaymentSubmission, {
    mappedBy: "items",
  }),
})

export default PaymentSubmissionItem
