import { Module, ModuleProvider, Modules } from "@medusajs/framework/utils"
import ResendNotificationProviderService from "./service"

export const RESEND_MODULE = "resend"

export default ModuleProvider(Modules.NOTIFICATION, {
  services: [ResendNotificationProviderService],
})
