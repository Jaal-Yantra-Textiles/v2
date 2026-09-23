import { Module } from "@medusajs/framework/utils"
import PartnerPushService from "./service"

export const PARTNER_PUSH_MODULE = "partnerPush"

const PartnerPushModule = Module(PARTNER_PUSH_MODULE, {
  service: PartnerPushService,
})

export { PartnerPushModule }
export default PartnerPushModule
