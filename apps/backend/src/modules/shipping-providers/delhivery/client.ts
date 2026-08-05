const STAGING_BASE = "https://staging-express.delhivery.com"
const PROD_BASE = "https://track.delhivery.com"

export type DelhiveryOptions = {
  api_token: string
  sandbox?: boolean
}

/**
 * Sanitize address fields for Delhivery — strip characters that cause API errors.
 */
function sanitizeAddress(value: string): string {
  return value.replace(/[&\#%;\\]/g, " ").replace(/\s+/g, " ").trim()
}

/**
 * Map a Delhivery scan to the coarse `scan_type` the tracking sync switches on.
 *
 * Delhivery reports status two ways and they disagree in useful ways: `Status`
 * is a broad bucket ("In Transit", "Dispatched") while `StatusType` is a single
 * letter — `UD` undelivered/in-transit, `DL` delivered, `RT` return-to-origin.
 * `NSLCode` refines it further (e.g. `EOD-*` end-of-day scans). Prefer the typed
 * codes and fall back to the free text, which is the only field Delhivery has
 * never changed the shape of.
 */
export function delhiveryScanType(
  statusType?: string | null,
  status?: string | null
): string {
  const type = String(statusType || "").trim().toUpperCase()
  if (type === "DL") return "delivered"
  if (type === "RT") return "rto"

  const text = String(status || "").trim().toLowerCase()
  if (text.includes("delivered")) return "delivered"
  if (text.includes("rto") || text.includes("return")) return "rto"
  if (text.includes("manifest") || text.includes("pickup scheduled")) {
    return "created"
  }
  if (text.includes("dispatched") || text.includes("out for delivery")) {
    return "shipped"
  }
  if (text.includes("in transit") || text.includes("in-transit")) {
    return "in_transit"
  }
  // `UD` with unrecognised text is still a live shipment, not a created one.
  return type === "UD" ? "in_transit" : "in_transit"
}

/**
 * Normalize a Delhivery status-push payload into a `TrackingResult`.
 *
 * Pure and exported so the inbound webhook route can parse a push without
 * carrier credentials — the same shape as `normalizeShiprocketWebhook`, so the
 * webhook route can dispatch on `?carrier=` and feed both into the one sync
 * workflow.
 *
 * Delhivery's push nests everything under `Shipment`, with the current scan in
 * `Shipment.Status` and the history in `Shipment.Scans[].ScanDetail`. Some
 * accounts receive a flatter shape, so both the nested and top-level AWB keys
 * are accepted. An unrecognised payload yields an empty `awb`, which the route
 * already treats as "ignore this push" rather than an error.
 */
export function normalizeDelhiveryWebhook(payload: any): {
  carrier: string
  awb: string
  current_status: string
  current_status_code?: string
  estimated_delivery?: string | null
  events: Array<{
    timestamp: string
    status: string
    location: string
    scan_type: string
  }>
  raw: any
} {
  const shipment = payload?.Shipment ?? payload?.shipment ?? payload ?? {}
  const status = shipment?.Status ?? shipment?.status ?? {}

  const awb =
    shipment?.AWB ??
    shipment?.awb ??
    shipment?.Waybill ??
    shipment?.waybill ??
    payload?.AWB ??
    payload?.waybill ??
    ""

  const currentStatus = status?.Status ?? status?.status ?? ""
  const statusType = status?.StatusType ?? status?.statusType ?? ""

  const events = (shipment?.Scans ?? shipment?.scans ?? []).map((s: any) => {
    const d = s?.ScanDetail ?? s?.scanDetail ?? s ?? {}
    return {
      timestamp: d?.ScanDateTime ?? d?.StatusDateTime ?? "",
      status: d?.Scan ?? d?.Instructions ?? d?.ScanType ?? "",
      location: d?.ScannedLocation ?? d?.StatusLocation ?? "",
      scan_type: delhiveryScanType(d?.StatusType ?? d?.ScanType, d?.Scan),
    }
  })

  return {
    carrier: "delhivery",
    awb: String(awb || ""),
    current_status: String(currentStatus || ""),
    current_status_code: statusType ? String(statusType) : undefined,
    estimated_delivery:
      shipment?.ExpectedDeliveryDate ?? shipment?.PromisedDeliveryDate ?? null,
    events,
    raw: payload,
  }
}

export class DelhiveryClient {
  private baseUrl: string
  private token: string

  constructor(options: DelhiveryOptions) {
    this.token = options.api_token
    this.baseUrl = options.sandbox ? STAGING_BASE : PROD_BASE
  }

  private headers(): Record<string, string> {
    return {
      Authorization: `Token ${this.token}`,
      "Content-Type": "application/json",
    }
  }

  /**
   * Safely parse response — Delhivery sometimes returns XML instead of JSON
   * (e.g. on auth errors, warehouse ops, cancel). Fall back to text.
   */
  private async safeJson(res: Response): Promise<any> {
    const text = await res.text()
    try {
      return JSON.parse(text)
    } catch {
      return { raw: text }
    }
  }

  async checkServiceability(pincode: string): Promise<any> {
    const res = await fetch(
      `${this.baseUrl}/c/api/pin-codes/json/?filter_codes=${pincode}`,
      { headers: this.headers() }
    )
    if (!res.ok) throw new Error(`Delhivery serviceability check failed (${res.status})`)
    return res.json()
  }

  /**
   * Calculate shipping cost using Delhivery Kinko Invoice API.
   *
   * Docs: https://delhivery-express-api-doc.readme.io/reference/invoice-shipping-charge-api
   *
   * Parameters:
   *   md   — Billing mode: "E" (Express) or "S" (Surface)
   *   cgm  — Chargeable weight in grams (integer > 0)
   *   o_pin — Origin pincode (6-digit Indian pincode)
   *   d_pin — Destination pincode (6-digit Indian pincode)
   *   ss   — Shipment status: "Delivered", "RTO", or "DTO"
   *
   * Rate limit: 40 requests/minute
   */
  async calculateShippingCost(params: {
    origin_pin: string
    destination_pin: string
    weight: number // grams
    mode?: "S" | "E"
  }): Promise<any> {
    // Ensure weight is a positive integer
    const weight = Math.max(1, Math.round(params.weight))

    const qs = new URLSearchParams({
      md: params.mode || "S",
      cgm: String(weight),
      o_pin: params.origin_pin,
      d_pin: params.destination_pin,
      ss: "Delivered",
    })

    const url = `${this.baseUrl}/api/kinko/v1/invoice/charges/.json?${qs}`
    console.log(`[Delhivery] Rate API request: ${url}`)

    const res = await fetch(url, { headers: this.headers() })

    if (!res.ok) {
      const body = await res.text().catch(() => "")
      console.error(`[Delhivery] Rate API ${res.status}: ${body}`)
      throw new Error(`Delhivery rate calculation failed (${res.status}): ${body}`)
    }
    return res.json()
  }

  /**
   * Register a warehouse/pickup location with Delhivery.
   * Must be done once per stock location before creating shipments.
   * The `name` must be used exactly (case-sensitive) in all future API calls.
   */
  async registerWarehouse(warehouse: {
    name: string
    phone: string
    pin: string
    city: string
    address: string
    email?: string
    return_address?: string
    return_pin?: string
    return_city?: string
    return_state?: string
    return_country?: string
    state?: string
    country?: string
  }): Promise<any> {
    const res = await fetch(`${this.baseUrl}/api/backend/clientwarehouse/create/`, {
      method: "POST",
      headers: {
        Authorization: `Token ${this.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: warehouse.name,
        phone: warehouse.phone,
        pin: warehouse.pin,
        city: warehouse.city,
        address: sanitizeAddress(warehouse.address),
        registered_name: warehouse.name,
        email: warehouse.email || "",
        return_address: warehouse.return_address
          ? sanitizeAddress(warehouse.return_address)
          : sanitizeAddress(warehouse.address),
        return_pin: warehouse.return_pin || warehouse.pin,
        return_city: warehouse.return_city || warehouse.city,
        return_state: warehouse.return_state || warehouse.state || "",
        return_country: warehouse.return_country || warehouse.country || "India",
        state: warehouse.state || "",
        country: warehouse.country || "India",
      }),
    })
    if (!res.ok) {
      const body = await res.text().catch(() => "")
      throw new Error(`Delhivery warehouse registration failed (${res.status}): ${body}`)
    }
    return this.safeJson(res)
  }

  /**
   * Schedule a pickup from a registered warehouse.
   * Only one active pickup per warehouse at a time.
   */
  async schedulePickup(params: {
    pickup_date: string // YYYY-MM-DD
    pickup_time: string // HH:mm or HH:mm:ss (Delhivery expects HH:mm:ss)
    pickup_location: string // registered warehouse name (exact match)
    expected_package_count: number
  }): Promise<any> {
    // Normalize time to HH:mm:ss if only HH:mm provided
    const time = params.pickup_time.length === 5
      ? `${params.pickup_time}:00`
      : params.pickup_time

    const res = await fetch(`${this.baseUrl}/fm/request/new/`, {
      method: "POST",
      headers: {
        Authorization: `Token ${this.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        pickup_time: time,
        pickup_date: params.pickup_date,
        pickup_location: params.pickup_location,
        expected_package_count: params.expected_package_count,
      }),
    })
    if (!res.ok) {
      const body = await res.text().catch(() => "")
      throw new Error(`Delhivery pickup scheduling failed (${res.status}): ${body}`)
    }
    return res.json()
  }

  async fetchWaybill(): Promise<string> {
    const res = await fetch(`${this.baseUrl}/waybill/api/fetch/`, {
      headers: this.headers(),
    })
    if (!res.ok) throw new Error(`Delhivery waybill fetch failed (${res.status})`)
    const text = await res.text()
    return text.trim()
  }

  async createShipment(shipment: {
    waybill?: string // empty string or omitted = auto-assign
    name: string
    phone: string
    address: string
    city: string
    pin: string
    state: string
    country?: string
    order_id: string
    payment_mode: "Pre-paid" | "COD"
    pickup_location_name: string // registered warehouse name (exact match)
    product_desc?: string
    weight: number // grams
    length?: number
    width?: number
    height?: number
    cod_amount?: number
    quantity?: number
    fragile_shipment?: boolean
    seller_gst_tin?: string
    hsn_code?: string
    seller_name?: string
    seller_address?: string
    seller_city?: string
    seller_pin?: string
    seller_state?: string
  }): Promise<any> {
    const shipmentData: Record<string, any> = {
      waybill: shipment.waybill || "",
      name: sanitizeAddress(shipment.name),
      phone: shipment.phone,
      add: sanitizeAddress(shipment.address),
      city: sanitizeAddress(shipment.city),
      pin: shipment.pin,
      state: shipment.state,
      country: shipment.country || "India",
      order: shipment.order_id,
      payment_mode: shipment.payment_mode,
      products_desc: shipment.product_desc || "",
      weight: shipment.weight,
      cod_amount: shipment.cod_amount || 0,
      quantity: shipment.quantity || 1,
      seller_name: shipment.seller_name || "",
      seller_add: shipment.seller_address ? sanitizeAddress(shipment.seller_address) : "",
      seller_city: shipment.seller_city || "",
      seller_pin: shipment.seller_pin || "",
      seller_state: shipment.seller_state || "",
    }

    if (shipment.fragile_shipment) shipmentData.fragile_shipment = "Y"
    if (shipment.seller_gst_tin) shipmentData.seller_gst_tin = shipment.seller_gst_tin
    if (shipment.hsn_code) shipmentData.hsn_code = shipment.hsn_code
    if (shipment.length) shipmentData.shipment_length = shipment.length
    if (shipment.width) shipmentData.shipment_width = shipment.width
    if (shipment.height) shipmentData.shipment_height = shipment.height

    const payload = {
      shipments: [shipmentData],
      pickup_location: {
        name: shipment.pickup_location_name,
      },
    }

    const form = `format=json&data=${encodeURIComponent(JSON.stringify(payload))}`

    const res = await fetch(`${this.baseUrl}/api/cmu/create.json`, {
      method: "POST",
      headers: {
        Authorization: `Token ${this.token}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: form,
    })
    if (!res.ok) {
      const body = await res.text()
      throw new Error(`Delhivery shipment creation failed (${res.status}): ${body}`)
    }
    return res.json()
  }

  async trackShipment(waybill: string): Promise<any> {
    const res = await fetch(
      `${this.baseUrl}/api/v1/packages/json/?waybill=${waybill}`,
      { headers: this.headers() }
    )
    if (!res.ok) throw new Error(`Delhivery tracking failed (${res.status})`)
    return res.json()
  }

  async getLabel(waybill: string): Promise<any> {
    const res = await fetch(
      `${this.baseUrl}/api/p/packing_slip?wbns=${waybill}`,
      { headers: this.headers() }
    )
    if (!res.ok) throw new Error(`Delhivery label fetch failed (${res.status})`)
    return res.json()
  }

  async cancelShipment(waybill: string): Promise<any> {
    const res = await fetch(`${this.baseUrl}/api/p/edit`, {
      method: "POST",
      headers: {
        Authorization: `Token ${this.token}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: `waybill=${waybill}&cancellation=true`,
    })
    if (!res.ok) {
      const body = await res.text().catch(() => "")
      throw new Error(`Delhivery cancellation failed (${res.status}): ${body}`)
    }
    return this.safeJson(res)
  }
}
