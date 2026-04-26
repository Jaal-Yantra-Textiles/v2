import { MedusaService } from "@medusajs/framework/utils"

import ProductionRun from "./models/production-run"
import ProductionRunActivity from "./models/production-run-activity"

class ProductionRunService extends MedusaService({
  ProductionRun,
  ProductionRunActivity,
}) {
  constructor() {
    super(...arguments)
  }
}

export default ProductionRunService
