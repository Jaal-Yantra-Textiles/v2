import { MedusaService } from "@medusajs/framework/utils"

import PartnerCapabilitySample from "./models/partner-capability-sample"

class PartnerCapabilityService extends MedusaService({
  PartnerCapabilitySample,
}) {}

export default PartnerCapabilityService
