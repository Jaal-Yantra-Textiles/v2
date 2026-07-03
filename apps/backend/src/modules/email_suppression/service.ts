import { MedusaService } from "@medusajs/framework/utils"
import EmailSuppression from "./models/email-suppression"

class EmailSuppressionService extends MedusaService({
  EmailSuppression,
}) {}

export default EmailSuppressionService
