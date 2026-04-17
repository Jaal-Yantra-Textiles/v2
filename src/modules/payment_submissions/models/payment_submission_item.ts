import { model } from "@medusajs/framework/utils"
import PaymentSubmission from "./payment_submission"

/**
 * A line item on a partner payment submission.
 *
 * An item is tied to either a design (the original behaviour) or a task
 * (partners can also submit individual completed tasks for payment). Exactly
 * one of `design_id` / `task_id` is expected to be set per row — enforced at
 * the workflow layer.
 */
const PaymentSubmissionItem = model.define("payment_submission_item", {
  id: model.id().primaryKey(),
  // Design source (nullable — may be a task-based item instead)
  design_id: model.text().nullable(),
  design_name: model.text().nullable(),
  // Task source (nullable — may be a design-based item instead)
  task_id: model.text().nullable(),
  task_name: model.text().nullable(),
  // Discriminator so consumers don't need to sniff which id is populated
  source_type: model
    .enum(["design", "task"])
    .default("design"),
  amount: model.bigNumber(),
  cost_breakdown: model.json().nullable(),
  metadata: model.json().nullable(),
  submission: model.belongsTo(() => PaymentSubmission, {
    mappedBy: "items",
  }),
})

export default PaymentSubmissionItem
