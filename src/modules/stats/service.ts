import { MedusaService } from "@medusajs/framework/utils"
import { StatsDashboard, StatsPanel } from "./models"

class StatsService extends MedusaService({
  StatsDashboard,
  StatsPanel,
}) {}

export default StatsService
