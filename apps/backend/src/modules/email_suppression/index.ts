import { Module } from "@medusajs/framework/utils"
import EmailSuppressionService from "./service"

export const EMAIL_SUPPRESSION_MODULE = "email_suppression"

const EmailSuppressionModule = Module(EMAIL_SUPPRESSION_MODULE, {
  service: EmailSuppressionService,
})

export { EmailSuppressionModule }

export default EmailSuppressionModule
