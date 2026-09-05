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

/**
 * Customs declaration for an INTERNATIONAL shipment (#1111). Only consulted when
 * the destination is outside the origin country. All fields optional — the
 * carrier client applies sensible retail-sale defaults (a commercial export,
 * FOB terms) when omitted. Values mirror Shiprocket's international
 * `create/adhoc` contract (see apps/docs/notes/SHIPROCKET_INTERNATIONAL_API.md).
 */
export type CustomsDeclaration = {
  /** 0 BONAFIDE_SAMPLE · 1 SAMPLE · 2 GIFT · 3 COMMERCIAL. Default 3 (a sale). */
  reason_of_export?: 0 | 1 | 2 | 3
  /** 0 gift · 1 sample · 2 commercial. Default 2. */
  purpose_of_shipment?: 0 | 1 | 2
  /**
   * The invoice VALUATION basis. Default "FOB".
   *
   * ⚠️ Not an incoterm in the "who pays duty" sense, despite the name and
   * despite Shiprocket calling its field `Terms_Of_Invoice`. It says whether
   * the declared value includes freight and insurance. Reading it as the
   * delivery term is how a DDP sale ends up declared duty-unpaid.
   */
  terms_of_invoice?: "FOB" | "CIF"
  /**
   * Who clears and pays destination duty (#1447).
   *
   * · `DAP` — delivered at place, duty UNPAID: the consignee is importer of
   *   record and meets the customs bill. This is the default and was, until
   *   this field existed, the only thing any adapter could say.
   * · `DDP` — delivered duty paid: WE clear and pay. Only send this when the
   *   sale was actually made DDP (`partner_quote.duties_prepaid`) and the
   *   carrier can honour it — see `can_declare_ddp` in `carrier-capabilities`.
   *
   * 🔴 A DDP sale shipped as DAP hands the buyer the customs bill we promised
   * they would not get, weeks after they paid, with our invoice as the
   * evidence they were told otherwise. Blue Dart's adapter hardcoded `"DAP"`
   * before this.
   */
  incoterm?: "DAP" | "DDP"
  /** IGST: A not-applicable · B LUT/Export-under-Bond · C against IGST payment. Default "A". */
  igst_payment_status?: "A" | "B" | "C"
  /** Whether the order is a commodity. Default true. */
  commodity?: boolean
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
  /**
   * ISO-4217 currency of the order amounts (#1111). Required by Shiprocket's
   * international create flow — the declared value / line prices are read in THIS
   * currency (not forced to INR). Ignored on domestic shipments. Shiprocket
   * supports INR, USD, GBP, EUR, AUD, CAD, SAR, AED, SGD.
   */
  currency?: string
  /**
   * Customs declaration for international destinations (#1111). Optional — the
   * carrier client fills retail-sale defaults. Ignored on domestic shipments.
   */
  customs?: CustomsDeclaration
  /**
   * The operator's chosen carrier service. When omitted, the provider
   * auto-selects.
   *
   * - Shiprocket (aggregator): the `courier_company_id` from a serviceability
   *   call — WHICH courier carries it.
   * - DTDC (single carrier, six services): the service type — `B2C PRIORITY`,
   *   `B2C GROUND ECONOMY` and so on. Accepts an id or a name.
   *
   * ⚠️ No longer "ignored by single-carrier providers": DTDC reads it, so a
   * value set for one carrier is not inert if the shipment is rebooked with
   * another. An unrecognised value is ignored rather than forwarded.
   */
  preferred_courier_id?: string | number
  product_description?: string
  /**
   * Seller tax / GST / VAT registration ID to stamp on the label (#348). The
   * partner's own ID when supplied, else the platform fallback resolved by the
   * order / ship-from country (IN→JYT GSTIN, EU→KHT VAT). Maps to Delhivery
   * `seller_gst_tin`. Resolve with `resolveSellerTaxIdForOrder`
   * (modules/shipping-providers/seller-tax-id).
   */
  tax_id?: string
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
  /** Set when a carrier pickup was scheduled alongside the shipment. */
  pickup?: { scheduled_date?: string; token?: string }
  raw?: any
}

export type RateQuery = {
  origin_pincode: string
  destination_pincode: string
  /**
   * Destination country. Optional because domestic callers never set it, but a
   * carrier with no export product needs it to refuse the quote rather than
   * pass a foreign postcode to an India-only rate API.
   */
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
  /**
   * Where the courier is actually being sent.
   *
   * Carriers that keep a pickup-location registry (Shiprocket, Delhivery) only
   * need `pickup_location_name` — the address lives on their side against that
   * nickname. Blue Dart has no such registry: the collection address travels
   * inline on every RegisterPickup call, so without this the request goes out
   * with a blank pincode and phone and is rejected `InvalidPinCode`.
   *
   * Same omission as `CreateShipmentInput.from` before #1293, on the other call.
   */
  from?: ShipmentAddress
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
export type CarrierId =
  | "delhivery"
  | "shiprocket"
  | "bluedart"
  | "dtdc"
  | "shipglobal"
  | "starfleet"
