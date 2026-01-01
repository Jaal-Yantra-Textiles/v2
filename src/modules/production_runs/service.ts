import { MedusaService } from "@medusajs/framework/utils"

import ProductionRun from "./models/production-run"

class ProductionRunService extends MedusaService({
  ProductionRun,
}) {
  constructor() {
    super(...arguments)
  }
}

export default ProductionRunService
