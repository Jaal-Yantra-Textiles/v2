import { ModuleProvider, Modules } from "@medusajs/framework/utils"
import MailjetNotificationProviderService from "./service"

export const MAILJET_MODULE = "mailjet"

export default ModuleProvider(Modules.NOTIFICATION, {
  services: [MailjetNotificationProviderService],
})
