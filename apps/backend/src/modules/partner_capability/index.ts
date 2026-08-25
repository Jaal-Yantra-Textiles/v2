import { Module } from "@medusajs/framework/utils"

import PartnerCapabilityService from "./service"

export const PARTNER_CAPABILITY_MODULE = "partner_capability"

export default Module(PARTNER_CAPABILITY_MODULE, {
  service: PartnerCapabilityService,
})
