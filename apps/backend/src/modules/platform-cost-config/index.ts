import { Module } from "@medusajs/framework/utils"
import PlatformCostConfigService from "./service"

// Re-exported so existing importers are unchanged; the constant itself lives
// in a leaf file that pulls no model. See module-key.ts.
export { PLATFORM_COST_CONFIG_MODULE } from "./module-key"
import { PLATFORM_COST_CONFIG_MODULE } from "./module-key"

const PlatformCostConfigModule = Module(PLATFORM_COST_CONFIG_MODULE, {
  service: PlatformCostConfigService,
})

export { PlatformCostConfigModule }

export default PlatformCostConfigModule
