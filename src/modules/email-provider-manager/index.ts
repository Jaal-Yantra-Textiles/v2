import { Module } from "@medusajs/framework/utils"
import EmailProviderManagerService from "./service"

export const EMAIL_PROVIDER_MANAGER_MODULE = "email_provider_manager"

export default Module(EMAIL_PROVIDER_MANAGER_MODULE, {
  service: EmailProviderManagerService,
})
