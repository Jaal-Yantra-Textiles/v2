import { MedusaService } from "@medusajs/framework/utils"

import PartnerCapabilityKnowledge from "./models/partner-capability-knowledge"
import PartnerCapabilitySample from "./models/partner-capability-sample"
import PartnerCapabilityScan from "./models/partner-capability-scan"

class PartnerCapabilityService extends MedusaService({
  PartnerCapabilitySample,
  PartnerCapabilityKnowledge,
  PartnerCapabilityScan,
}) {}

export default PartnerCapabilityService
