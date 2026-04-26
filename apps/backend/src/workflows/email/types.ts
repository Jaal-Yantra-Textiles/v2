export interface SendNotificationEmailInput {
  to: string
  template: string
  data?: Record<string, any>
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
