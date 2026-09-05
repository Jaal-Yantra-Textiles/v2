export type PaymentMode = "prepaid" | "cod"

export type ShipmentAddress = {
  name: string
  phone: string
  email?: string
  address_1: string
  address_2?: string
  city: string
  state: string
  pincode: string
  country?: string
}

export type ShipmentItem = {
  name: string
  sku?: string
  quantity: number
  unit_price: number
  hsn?: string
  tax?: number
}

export type Dimensions = {
  length: number
  width: number
  height: number
}

export type CreateShipmentInput = {
  reference_id: string
  payment_mode: PaymentMode
  cod_amount?: number
  pickup_location_name: string
  to: ShipmentAddress
  from?: ShipmentAddress
  items: ShipmentItem[]
  weight_grams: number
  dimensions_cm?: Dimensions
  sub_total?: number
  currency?: string
  product_description?: string
  tax_id?: string
  /**
   * The operator's chosen carrier service, mirroring the backend's
   * `preferred_courier_id` (which Shiprocket reads as `courier_company_id`).
   *
   * DTDC is a single carrier with SIX services, so the choice that matters here
   * is which product carries the parcel — `B2C PRIORITY` vs `B2C GROUND
   * ECONOMY` and so on. Accepts an id or a name; see `service-types.ts`.
   *
   * When omitted the provider falls back to the configured default, and only
   * then to the weight/size heuristic.
   */
  preferred_courier_id?: string | number
}

export type ShipmentRef = {
  awb?: string
  provider_refs?: Record<string, any>
}

export type ShipmentResult = {
  carrier: string
  awb: string
  tracking_number: string
  tracking_url?: string
  label_url?: string
  provider_refs?: Record<string, any>
  raw?: any
}

export type RateQuery = {
  origin_pincode: string
  destination_pincode: string
  destination_country?: string
  weight_grams: number
  cod?: boolean
  dimensions_cm?: Dimensions
}

export type RateOption = {
  courier_id?: string | number
  courier_name?: string
  amount: number
  currency_code: string
  estimated_days?: number
  cod_charges?: number
  is_recommended?: boolean
}

export type TrackingEvent = {
  timestamp: string
  status: string
  location: string
  scan_type: string
}

export type TrackingResult = {
  carrier: string
  awb: string
  current_status: string
  current_status_code?: string | number
  estimated_delivery?: string | null
  origin?: string
  destination?: string
  events: TrackingEvent[]
  raw?: any
}

export type LabelResult = {
  label_url?: string
  data?: string
  format?: string
  raw?: any
}

export interface ShippingProviderClient {
  readonly carrier: string
  checkServiceability?(destinationPincode: string): Promise<boolean>
  getRates?(query: RateQuery): Promise<RateOption[]>
  createShipment(input: CreateShipmentInput): Promise<ShipmentResult>
  getLabel(ref: ShipmentRef): Promise<LabelResult>
  track(ref: ShipmentRef): Promise<TrackingResult>
  cancelShipment(ref: ShipmentRef): Promise<{ success: boolean; raw?: any }>
  normalizeWebhook?(payload: any): TrackingResult
}
