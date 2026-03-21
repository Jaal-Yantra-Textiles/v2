import { Module } from "@medusajs/framework/utils"
import PartnerPaymentConfigService from "./service"

export const PARTNER_PAYMENT_CONFIG_MODULE = "partner_payment_config"

export default Module(PARTNER_PAYMENT_CONFIG_MODULE, {
  service: PartnerPaymentConfigService,
})
