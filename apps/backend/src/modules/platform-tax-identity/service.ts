import { MedusaService } from "@medusajs/framework/utils"
import PlatformTaxIdentity from "./models/platform-tax-identity"

class PlatformTaxIdentityService extends MedusaService({
  PlatformTaxIdentity,
}) {
  constructor() {
    super(...arguments)
  }
}

export default PlatformTaxIdentityService
