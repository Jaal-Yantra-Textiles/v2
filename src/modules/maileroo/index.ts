import { ModuleProvider, Modules } from "@medusajs/framework/utils"
import MailerooNotificationProviderService from "./service"

export const MAILEROO_MODULE = "maileroo"

export default ModuleProvider(Modules.NOTIFICATION, {
  services: [MailerooNotificationProviderService],
})
