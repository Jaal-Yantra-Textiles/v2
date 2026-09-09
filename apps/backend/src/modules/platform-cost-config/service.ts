import { MedusaService } from "@medusajs/framework/utils"
import PlatformCostConfig from "./models/platform-cost-config"

class PlatformCostConfigService extends MedusaService({
  PlatformCostConfig,
}) {
  constructor() {
    super(...arguments)
  }
}

export default PlatformCostConfigService
