export interface SendNotificationEmailInput {
  to: string
  template: string
  data?: Record<string, any>
  locale?: string
  /**
   * Files to attach (#2532), base64 `content`. Only the Resend provider
   * ("email" channel) sends them; other providers ignore them.
   */
  attachments?: EmailAttachment[]
}

export interface EmailAttachment {
  filename: string
  /** Base64-encoded file content. */
  content: string
  content_type?: string
}

export interface EmailTemplateData {
  subject: string
  html_content: string
  from?: string
  variables?: Record<string, unknown>
}

export interface ProcessedEmailTemplateData {
  subject: string
  html_content: string
  from?: string
  processed: boolean
}

export type ShipmentStatusVariant = "shipped" | "delivered"

export interface SendShipmentStatusEmailInput {
  shipment_id: string
  status: ShipmentStatusVariant
}
