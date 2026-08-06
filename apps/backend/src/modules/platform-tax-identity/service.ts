import { MedusaService } from "@medusajs/framework/utils"
import PlatformTaxIdentity from "./models/platform-tax-identity"
import PlatformExportLut from "./models/platform-export-lut"

class PlatformTaxIdentityService extends MedusaService({
  PlatformTaxIdentity,
  PlatformExportLut,
}) {
  constructor() {
    super(...arguments)
  }
}

export default PlatformTaxIdentityService
