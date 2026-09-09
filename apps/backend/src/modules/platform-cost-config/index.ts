import { Module } from "@medusajs/framework/utils"
import PlatformCostConfigService from "./service"

export const PLATFORM_COST_CONFIG_MODULE = "platform_cost_config"

const PlatformCostConfigModule = Module(PLATFORM_COST_CONFIG_MODULE, {
  service: PlatformCostConfigService,
})

export { PlatformCostConfigModule }

export default PlatformCostConfigModule
