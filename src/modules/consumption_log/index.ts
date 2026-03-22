import { Module } from "@medusajs/framework/utils"
import ConsumptionLogService from "./service"

export const CONSUMPTION_LOG_MODULE = "consumption_log"

const ConsumptionLogModule = Module(CONSUMPTION_LOG_MODULE, {
  service: ConsumptionLogService,
})

export { ConsumptionLogModule }

export default ConsumptionLogModule
