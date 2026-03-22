import { MedusaService } from "@medusajs/framework/utils"
import ConsumptionLog from "./models/consumption-log"

class ConsumptionLogService extends MedusaService({
  ConsumptionLog,
}) {
  constructor() {
    super(...arguments)
  }
}

export default ConsumptionLogService
