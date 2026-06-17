/**
 * Carrier-agnostic shipping-provider interface (#31 spike).
 *
 * Normalizes the capabilities our admin/partner surfaces need — create
 * shipment + AWB, label, track, cancel, schedule pickup, register pickup
 * location — across providers whose native flows differ in shape:
 *
 *   - Delhivery: single-carrier; `create.json` creates the waybill AND assigns
 *     the AWB in one call; explicit `cod_amount`; static API-key auth.
 *   - Shiprocket: multi-carrier aggregator; `create/adhoc` returns a
 *     `shipment_id` with NO AWB, then `assign/awb` assigns it (optionally
 *     picking a `courier_id` from a serviceability call); COD amount derived
 *     from `sub_total`; JWT auth (10-day TTL, re-login to refresh).
 *
 * The interface hides those differences so consumer routes resolve a provider
 * by `fulfillment.data.carrier` and call one shape — instead of `new
 * DelhiveryClient(...)` + `if (carrier === "delhivery")` branches.
 *
 * Credentials are NOT read from env here. The resolver (`resolver.ts`) pulls
 * them from the `SocialPlatform` external-platform store (`category:
 * "shipping"`), decrypted via the encryption module. See SHIPPING_PROVIDERS.md.
 */

export type PaymentMode = "prepaid" | "cod"

export type ShipmentAddress = {
  name: string
  phone: string
  email?: string
  address_1: string
  address_2?: string
  city: string
  /** State / province. */
  state: string
  /** Postal / PIN code. */
  pincode: string
  /** Country name or ISO code; defaults to "India" per provider when omitted. */
  country?: string
}

export type ShipmentItem = {
  name: string
  sku?: string
  quantity: number
  /** Per-unit selling price (GST-inclusive for Shiprocket). */
  unit_price: number
  hsn?: string
  /** Tax percentage, if known. */
  tax?: number
}

export type Dimensions = {
  /** centimetres */
  length: number
  width: number
  height: number
}

export type CreateShipmentInput = {
  /** Our order / fulfillment id — the external reference the carrier echoes back. */
  reference_id: string
  payment_mode: PaymentMode
  /** Required when `payment_mode === "cod"`. Major currency units. */
  cod_amount?: number
  /** Registered pickup-location name (exact, case-sensitive match at the carrier). */
  pickup_location_name: string
  to: ShipmentAddress
  /** Seller / origin address. Delhivery includes it on the shipment; Shiprocket
   *  derives it from the registered `pickup_location_name`. */
  from?: ShipmentAddress
  items: ShipmentItem[]
  /** Total chargeable weight in grams. */
  weight_grams: number
  dimensions_cm?: Dimensions
  /** Order sub-total (major units). Shiprocket requires it; also the COD amount. */
  sub_total?: number
  /** Aggregator courier choice (Shiprocket `courier_company_id`). Ignored by
   *  single-carrier providers. When omitted, the provider auto-selects. */
  preferred_courier_id?: string | number
  product_description?: string
}

/**
 * Opaque-ish handle to a created shipment. `awb` alone is enough for Delhivery;
 * Shiprocket needs `provider_refs.shipment_id` for label/track/cancel, so
 * persist the whole thing on `fulfillment.data` and pass it back in.
 */
export type ShipmentRef = {
  awb?: string
  /** Carrier-specific ids, e.g. Shiprocket `{ sr_order_id, shipment_id }`. */
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
  /** Coarse classification consumers can switch on: created/shipped/delivered/… */
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

export type SchedulePickupInput = {
  pickup_location_name: string
  /** YYYY-MM-DD */
  pickup_date?: string
  /** HH:mm or HH:mm:ss */
  pickup_time?: string
  expected_package_count?: number
  /** Some providers schedule per-shipment rather than per-location. */
  ref?: ShipmentRef
}

export type SchedulePickupResult = {
  scheduled_date?: string
  token?: string
  raw?: any
}

export type RegisterPickupLocationInput = {
  /** The name future calls reference (Delhivery warehouse / Shiprocket pickup_location). */
  name: string
  phone: string
  email?: string
  address_1: string
  address_2?: string
  city: string
  state: string
  pincode: string
  country?: string
  gstin?: string
}

/**
 * A registered pickup location as the carrier reports it. The nickname is what
 * `createShipment`/`registerPickupLocation` reference. Callers lead with
 * `shippable` (can this pickup be used for live pickups?) — for Shiprocket an
 * API-registered pickup is shippable once its address is complete; phone-OTP is
 * a separate dashboard step that isn't required (#435). `phone_verified` stays
 * as a secondary, informational signal. See SHIPPING_PROVIDERS.md §9.
 */
export type PickupLocation = {
  /** The unique nickname callers reference (Shiprocket `pickup_location`). */
  name: string
  /** Carrier-side id, when exposed. */
  id?: string | number
  /** True when the carrier reports the pickup phone as OTP-verified (informational). */
  phone_verified?: boolean
  /** True when the carrier row has a complete address (address, city, pincode, phone). */
  address_complete?: boolean
  /** True when the pickup is usable for live pickups (the source of truth for UI). */
  shippable?: boolean
  city?: string
  state?: string
  pincode?: string
  raw?: any
}

export type LabelResult = {
  label_url?: string
  /** Base64-encoded label payload when the provider returns bytes, not a URL. */
  data?: string
  format?: string
  raw?: any
}

/**
 * The normalized contract every carrier client implements (or is adapted to).
 * Optional methods reflect capabilities not every provider exposes over API.
 */
export interface ShippingProviderClient {
  readonly carrier: string

  /** True if the destination is serviceable. Optional — not all carriers expose it. */
  checkServiceability?(destinationPincode: string): Promise<boolean>

  /** Rate / courier options for a lane. Aggregators return many; single carriers one. */
  getRates?(query: RateQuery): Promise<RateOption[]>

  /** Create the shipment and (for aggregators) assign an AWB, returning a uniform result. */
  createShipment(input: CreateShipmentInput): Promise<ShipmentResult>

  getLabel(ref: ShipmentRef): Promise<LabelResult>

  track(ref: ShipmentRef): Promise<TrackingResult>

  cancelShipment(ref: ShipmentRef): Promise<{ success: boolean; raw?: any }>

  schedulePickup?(input: SchedulePickupInput): Promise<SchedulePickupResult>

  registerPickupLocation?(
    input: RegisterPickupLocationInput
  ): Promise<{ name: string; raw?: any }>

  /**
   * List the carrier's registered pickup locations. Used for idempotent
   * registration (skip if the nickname already exists) and to surface
   * phone-verification status. Optional — not every carrier exposes a list API.
   */
  listPickupLocations?(): Promise<PickupLocation[]>

  /** Normalize an inbound tracking webhook payload (P2). */
  normalizeWebhook?(payload: any): TrackingResult
}

/** Known carrier identifiers persisted on `fulfillment.data.carrier`. */
export type CarrierId = "delhivery" | "shiprocket"
