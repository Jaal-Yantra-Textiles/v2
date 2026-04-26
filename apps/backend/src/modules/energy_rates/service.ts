import { MedusaService } from "@medusajs/framework/utils"
import EnergyRate from "./models/energy-rate"

class EnergyRateService extends MedusaService({
  EnergyRate,
}) {
  constructor() {
    super(...arguments)
  }
}

export default EnergyRateService
