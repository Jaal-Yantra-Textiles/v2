export type ShippingLabel = {
  url?: string
  data?: string // base64-encoded label
  format?: string // "PDF" | "PNG" | "ZPL"
  name?: string
}

export type ShipmentResult = {
  tracking_number: string
  carrier_tracking_url?: string
  labels: ShippingLabel[]
  data?: Record<string, any>
}

export type RateResult = {
  amount: number
  currency_code: string
  estimated_days?: number
  service_name?: string
}
