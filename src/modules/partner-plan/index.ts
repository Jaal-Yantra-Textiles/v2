import { Module } from "@medusajs/framework/utils"
import PartnerPlanService from "./service"

export const PARTNER_PLAN_MODULE = "partnerPlan"

const PartnerPlanModule = Module(PARTNER_PLAN_MODULE, {
  service: PartnerPlanService,
})

export { PartnerPlanModule }
export default PartnerPlanModule
