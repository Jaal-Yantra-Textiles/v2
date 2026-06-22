import { Module } from "@medusajs/framework/utils"
import PlatformTaxIdentityService from "./service"

export const PLATFORM_TAX_IDENTITY_MODULE = "platform_tax_identity"

const PlatformTaxIdentityModule = Module(PLATFORM_TAX_IDENTITY_MODULE, {
  service: PlatformTaxIdentityService,
})

export { PlatformTaxIdentityModule }

export default PlatformTaxIdentityModule
