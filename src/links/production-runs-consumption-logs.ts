import { defineLink } from "@medusajs/framework/utils"
import ProductionRunsModule from "../modules/production_runs"
import ConsumptionLogModule from "../modules/consumption_log"

export default defineLink(
  { linkable: ProductionRunsModule.linkable.productionRuns, isList: true },
  {
    linkable: ConsumptionLogModule.linkable.consumptionLog,
    isList: true,
    field: "consumption_logs",
  }
)
