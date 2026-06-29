/**
 * Canonical list of every WhatsApp template the platform manages. Single source
 * for both the CLI (`manage-whatsapp-templates.ts`) and the Data-Plumbing job
 * (`sync-whatsapp-templates`). Add a new domain's TemplateSpec[] here once and
 * both push paths pick it up.
 */
import { PARTNER_RUN_TEMPLATES, type TemplateSpec } from "./partner-run-templates"
import { PARTNER_PAYMENT_TEMPLATES } from "./partner-payment-templates"
import { INVENTORY_ORDER_TEMPLATES } from "./inventory-order-templates"

export const ALL_WHATSAPP_TEMPLATES: TemplateSpec[] = [
  ...PARTNER_RUN_TEMPLATES,
  ...PARTNER_PAYMENT_TEMPLATES,
  ...INVENTORY_ORDER_TEMPLATES, // #771 inventory-order status notifications
]
