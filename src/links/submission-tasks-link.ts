import { defineLink } from "@medusajs/framework/utils"
import PaymentSubmissionsModule from "../modules/payment_submissions"
import TasksModule from "../modules/tasks"

// PaymentSubmission <-> Task (many:many)
// Enables partners to submit individual completed tasks for payment alongside
// (or independently of) designs.
export default defineLink(
  {
    linkable: PaymentSubmissionsModule.linkable.paymentSubmission,
    isList: true,
  },
  {
    linkable: TasksModule.linkable.task,
    isList: true,
  }
)
