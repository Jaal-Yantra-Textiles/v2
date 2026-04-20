import { Module } from "@medusajs/framework/utils"
import GoogleMerchantService from "./service"

export const GOOGLE_MERCHANT_MODULE = "google_merchant"

export { default as GoogleMerchantService } from "./service"

const GoogleMerchantModule = Module(GOOGLE_MERCHANT_MODULE, {
  service: GoogleMerchantService,
})

export default GoogleMerchantModule
