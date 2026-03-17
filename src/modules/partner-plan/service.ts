import { MedusaService } from "@medusajs/framework/utils"
import PartnerPlan from "./models/partner-plan"
import PartnerSubscription from "./models/partner-subscription"

class PartnerPlanService extends MedusaService({
  PartnerPlan,
  PartnerSubscription,
}) {
  constructor() {
    super(...arguments)
  }
}

export default PartnerPlanService
