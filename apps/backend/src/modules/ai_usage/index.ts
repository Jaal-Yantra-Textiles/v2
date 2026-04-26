import { Module } from "@medusajs/framework/utils"
import AiUsageService from "./service"

export const AI_USAGE_MODULE = "ai_usage"

const AiUsageModule = Module(AI_USAGE_MODULE, {
  service: AiUsageService,
})

export { AiUsageModule }

export default AiUsageModule
