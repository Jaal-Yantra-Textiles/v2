import { MedusaService } from "@medusajs/framework/utils"
import InboundEmail from "./models/inbound-email"

class InboundEmailService extends MedusaService({
  InboundEmail,
}) {}

export default InboundEmailService
