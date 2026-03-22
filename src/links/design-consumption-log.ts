import { defineLink } from "@medusajs/framework/utils"
import DesignModule from "../modules/designs"
import ConsumptionLogModule from "../modules/consumption_log"

export default defineLink(
  DesignModule.linkable.design,
  {
    linkable: ConsumptionLogModule.linkable.consumptionLog,
    isList: true,
  }
)
