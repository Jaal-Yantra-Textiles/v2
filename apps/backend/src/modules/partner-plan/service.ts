import { MedusaService } from "@medusajs/framework/utils"
import PartnerPlan from "./models/partner-plan"
import PartnerSubscription from "./models/partner-subscription"
import SubscriptionPayment from "./models/subscription-payment"

class PartnerPlanService extends MedusaService({
  PartnerPlan,
  PartnerSubscription,
  SubscriptionPayment,
}) {
  constructor() {
    super(...arguments)
  }
}

export default PartnerPlanService
