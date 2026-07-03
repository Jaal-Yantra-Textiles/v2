import { MedusaService } from "@medusajs/framework/utils"
import AudienceGroup from "./models/audience-group"
import AudienceEntry from "./models/audience-entry"

class AudienceService extends MedusaService({
  AudienceGroup,
  AudienceEntry,
}) {}

export default AudienceService
