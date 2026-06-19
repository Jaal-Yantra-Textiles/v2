import { Module } from "@medusajs/framework/utils"
import PartnerBillingService from "./service"

export const PARTNER_BILLING_MODULE = "partner_billing"

export default Module(PARTNER_BILLING_MODULE, {
  service: PartnerBillingService,
})
