import { Module } from "@medusajs/framework/utils"

import EmailEngagementService from "./service"

export const EMAIL_ENGAGEMENT_MODULE = "email_engagement"

const EmailEngagementModule = Module(EMAIL_ENGAGEMENT_MODULE, {
  service: EmailEngagementService,
})

export { EmailEngagementModule }

export default EmailEngagementModule
