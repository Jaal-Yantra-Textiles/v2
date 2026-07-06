import { MedusaService } from "@medusajs/framework/utils"

import EmailEngagement from "./models/email-engagement"
import EmailEngagementEvent from "./models/email-engagement-event"

class EmailEngagementService extends MedusaService({
  EmailEngagement,
  EmailEngagementEvent,
}) {}

export default EmailEngagementService
