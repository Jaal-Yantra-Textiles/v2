import { MedusaService } from "@medusajs/framework/utils"

import ProductionRun from "./models/production-run"
import ProductionRunActivity from "./models/production-run-activity"
import ProductionRunReminder from "./models/production-run-reminder"
import ProductionRunSale from "./models/production-run-sale"
import ProductionRunSettlement from "./models/production-run-settlement"

class ProductionRunService extends MedusaService({
  ProductionRun,
  ProductionRunActivity,
  ProductionRunReminder,
  ProductionRunSale,
  ProductionRunSettlement,
}) {
  constructor() {
    super(...arguments)
  }
}

export default ProductionRunService
