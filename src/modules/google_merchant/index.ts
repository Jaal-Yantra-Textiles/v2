import { Module } from "@medusajs/framework/utils"
import GoogleMerchantService from "./service"

export const GOOGLE_MERCHANT_MODULE = "google_merchant"

export { default as GoogleMerchantService } from "./service"
export type { GoogleMerchantApiConfig } from "./types"
export { API_CONFIG_KNOWN_KEYS, validateApiConfigPatch } from "./types"

const GoogleMerchantModule = Module(GOOGLE_MERCHANT_MODULE, {
  service: GoogleMerchantService,
})

export default GoogleMerchantModule
