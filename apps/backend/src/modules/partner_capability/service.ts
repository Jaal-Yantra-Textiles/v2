import { MedusaService } from "@medusajs/framework/utils"

import PartnerCapabilityKnowledge from "./models/partner-capability-knowledge"
import PartnerCapabilitySample from "./models/partner-capability-sample"
import PartnerWebsiteScan from "./models/partner-website-scan"

class PartnerCapabilityService extends MedusaService({
  PartnerCapabilitySample,
  PartnerCapabilityKnowledge,
  PartnerWebsiteScan,
}) {}

export default PartnerCapabilityService
