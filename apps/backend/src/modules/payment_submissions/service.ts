import { MedusaService } from "@medusajs/framework/utils"
import PaymentSubmission from "./models/payment_submission"
import PaymentSubmissionItem from "./models/payment_submission_item"

class PaymentSubmissionsService extends MedusaService({
  PaymentSubmission,
  PaymentSubmissionItem,
}) {
  constructor() {
    super(...arguments)
  }
}

export default PaymentSubmissionsService
