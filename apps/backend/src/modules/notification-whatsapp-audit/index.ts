import { ModuleProvider, Modules } from "@medusajs/framework/utils"
import WhatsappAuditNotificationProviderService from "./service"

export const NOTIFICATION_WHATSAPP_AUDIT_MODULE = "notification-whatsapp-audit"

export default ModuleProvider(Modules.NOTIFICATION, {
  services: [WhatsappAuditNotificationProviderService],
})
