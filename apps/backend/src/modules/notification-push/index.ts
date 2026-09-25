import { ModuleProvider, Modules } from "@medusajs/framework/utils"
import PartnerPushNotificationProviderService from "./service"

export const NOTIFICATION_PUSH_MODULE = "notification-push"

export default ModuleProvider(Modules.NOTIFICATION, {
  services: [PartnerPushNotificationProviderService],
})
