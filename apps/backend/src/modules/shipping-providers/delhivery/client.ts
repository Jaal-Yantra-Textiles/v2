import { MedusaError } from "@medusajs/framework/utils"

const STAGING_BASE = "https://staging-express.delhivery.com"
const PROD_BASE = "https://track.delhivery.com"

/** Injectable transport, so tests can run the full flow without a live call. */
export type FetchLike = (
  input: string,
  init?: Record<string, any>
) => Promise<any>

export type DelhiveryOptions = {
  api_token: string
  sandbox?: boolean
  /**
   * Deterministic transport for tests/CI (`DELHIVERY_STUB=1`). Delhivery has NO
   * usable sandbox — `staging-express` 401s our live token — so every real
   * `create` mints a BILLABLE waybill on the live account. Creation behaviour is
   * therefore verified against this stub, never against a live probe.
   */
  fetchImpl?: FetchLike
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
 * Coerce a Delhivery timestamp into an ISO string.
 *
 * The nested track envelope uses ISO strings; the flat scan push uses an epoch
 * (their sample types it `Number`, and accounts have been seen sending both
 * seconds and milliseconds). Anything unrecognised yields `""`, which the
 * tracking timeline treats as "no time recorded" rather than 1970.
 */
export function delhiveryTimestamp(value: any): string {
  if (value == null || value === "") return ""

  const num = typeof value === "number" ? value : Number(value)
  // A numeric zero/negative is "no time recorded", not 1970 and not the
  // literal string "0".
  if (Number.isFinite(num) && String(value).trim() !== "") {
    if (num <= 0) return ""
    // Seconds vs milliseconds: anything below ~2001-09-09 in ms is really an
    // epoch in seconds. Delhivery's sample is unlabelled, so both are accepted.
    const ms = num < 1e12 ? num * 1000 : num
    const d = new Date(ms)
    if (!Number.isNaN(d.getTime())) return d.toISOString()
  }

  return String(value)
}

/**
 * Normalize a Delhivery status-push payload into a `TrackingResult`.
 *
 * Pure and exported so the inbound webhook route can parse a push without
 * carrier credentials — the same shape as `normalizeShiprocketWebhook`, so the
 * webhook route can dispatch on `?carrier=` and feed both into the one sync
 * workflow.
 *
 * TWO shapes are accepted, because Delhivery pushes different ones per account:
 *
 *  1. The **nested** envelope, matching their track API — everything under
 *     `Shipment`, the current scan in `Shipment.Status`, history in
 *     `Shipment.Scans[].ScanDetail`.
 *  2. The **flat** scan push printed in their webhook requirement document
 *     (`{ status, location, timestamp, lrnum, mwn, shipment_remark, ... }`),
 *     which carries a single scan and no history array.
 *
 * Shape 2 matters: it has no `AWB`/`Waybill` key at all, and its `status` is a
 * bare string rather than an object. Read with only shape 1 in mind it yields
 * an empty AWB — and the webhook route treats an empty AWB as "ignore this
 * push", so every delivery update would be dropped in silence with nothing in
 * the log but "test webhook?". Both shapes are parsed here so whichever the
 * account is configured for, the AWB is found.
 *
 * An unrecognised payload still yields an empty `awb`, which the route already
 * treats as "ignore this push" rather than an error.
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
  const rawStatus = shipment?.Status ?? shipment?.status ?? {}

  // The flat push sends `status` as a string; the nested one as an object.
  const flatStatus = typeof rawStatus === "string" ? rawStatus : ""
  const status = typeof rawStatus === "object" && rawStatus ? rawStatus : {}

  const awb =
    shipment?.AWB ??
    shipment?.awb ??
    shipment?.Waybill ??
    shipment?.waybill ??
    shipment?.wbn ??
    payload?.AWB ??
    payload?.awb ??
    payload?.waybill ??
    payload?.wbn ??
    // Flat push: the consignment number rides in `lrnum`, with `mwn` (master
    // waybill) as the fallback for accounts pushing at master level.
    shipment?.lrnum ??
    shipment?.mwn ??
    payload?.lrnum ??
    payload?.mwn ??
    ""

  const currentStatus =
    status?.Status ?? status?.status ?? flatStatus ?? ""
  const statusType =
    status?.StatusType ??
    status?.statusType ??
    shipment?.status_type ??
    shipment?.StatusType ??
    shipment?.nsl_code ??
    ""

  const scans = shipment?.Scans ?? shipment?.scans ?? []
  const events = (Array.isArray(scans) ? scans : []).map((s: any) => {
    const d = s?.ScanDetail ?? s?.scanDetail ?? s ?? {}
    return {
      timestamp: delhiveryTimestamp(d?.ScanDateTime ?? d?.StatusDateTime),
      status: d?.Scan ?? d?.Instructions ?? d?.ScanType ?? "",
      location: d?.ScannedLocation ?? d?.StatusLocation ?? "",
      scan_type: delhiveryScanType(d?.StatusType ?? d?.ScanType, d?.Scan),
    }
  })

  // The flat push has no history array — it IS one scan. Synthesise the event
  // so the shipment timeline records it, exactly as the nested shape would.
  if (!events.length && awb && currentStatus) {
    events.push({
      timestamp: delhiveryTimestamp(
        shipment?.timestamp ?? shipment?.StatusDateTime ?? status?.StatusDateTime
      ),
      status: String(currentStatus),
      location: String(
        shipment?.location ?? status?.StatusLocation ?? shipment?.StatusLocation ?? ""
      ),
      scan_type: delhiveryScanType(
        statusType,
        // `shipment_remark` carries the detail ("Delivered to consignee") that
        // disambiguates a terse status.
        `${currentStatus} ${shipment?.shipment_remark ?? ""}`.trim()
      ),
    })
  }

  const eta =
    shipment?.ExpectedDeliveryDate ??
    shipment?.PromisedDeliveryDate ??
    shipment?.expected_delivery_date ??
    shipment?.promised_delivery_date ??
    null

  return {
    carrier: "delhivery",
    awb: String(awb || ""),
    current_status: String(currentStatus || ""),
    current_status_code: statusType ? String(statusType) : undefined,
    estimated_delivery: eta == null ? null : delhiveryTimestamp(eta),
    events,
    raw: payload,
  }
}

/**
 * Normalize a Delhivery EPOD (electronic proof of delivery) push.
 *
 * Their requirement document specifies `{ waybill, EPOD, orderID }`, where
 * `EPOD` is a base64-encoded document. The same webhook can also be configured
 * to push a downloadable S3 URL (7-day expiry) instead of the blob, so both are
 * accepted and reported separately — a URL must be fetched before it expires,
 * a blob is already in hand.
 *
 * Key casing is inconsistent across Delhivery's own docs (`EPOD` in the sample,
 * `epod` elsewhere), so lookups are case-insensitive over the top-level keys.
 *
 * Pure, so the webhook route can parse without credentials. An unrecognised
 * payload yields an empty `awb`, which the route treats as "ignore this push".
 */
export function normalizeDelhiveryEpod(payload: any): {
  carrier: string
  awb: string
  /** Base64 document body, when Delhivery pushes the blob. */
  pod_base64?: string
  /** Downloadable URL, when Delhivery pushes a link instead (expires in 7 days). */
  pod_url?: string
  /** The client order reference Delhivery echoes back, when present. */
  order_ref?: string
  raw: any
}  {
  const src = payload && typeof payload === "object" ? payload : {}

  // Case-insensitive top-level lookup: `EPOD` vs `epod` differs between
  // Delhivery's sample payload and their prose.
  const byLower: Record<string, any> = {}
  for (const [k, v] of Object.entries(src)) {
    byLower[k.toLowerCase()] = v
  }
  const pick = (...keys: string[]) => {
    for (const k of keys) {
      const v = byLower[k]
      if (v != null && v !== "") return v
    }
    return undefined
  }

  const awb = pick("waybill", "awb", "wbn", "lrnum", "mwn")
  const pod = pick("epod", "pod", "pod_data", "image")
  const orderRef = pick("orderid", "order_id", "reference_no", "order_ref")

  const podStr = pod == null ? "" : String(pod)
  // A URL and a base64 blob arrive in the same field; only a URL starts with a
  // scheme. Treating a URL as base64 would persist an unusable document.
  const isUrl = /^https?:\/\//i.test(podStr.trim())

  return {
    carrier: "delhivery",
    awb: String(awb ?? ""),
    pod_base64: !isUrl && podStr ? podStr : undefined,
    pod_url: isUrl ? podStr.trim() : undefined,
    order_ref: orderRef == null ? undefined : String(orderRef),
    raw: payload,
  }
}

/**
 * A Delhivery call that came back 200 but refused the work.
 *
 * A `MedusaError` so the framework's error handler returns a clean
 * `{ type, message }` with a real status code instead of an opaque 500
 * (see the #1202 status-mapping fix).
 */
export class DelhiveryApiError extends MedusaError {
  /** `unregistered_pickup` when the named warehouse doesn't exist on the account. */
  readonly code?: string
  readonly raw?: any

  constructor(message: string, opts?: { code?: string; raw?: any }) {
    super(MedusaError.Types.INVALID_DATA, message)
    this.code = opts?.code
    this.raw = opts?.raw
  }
}

/** Delhivery's phrasing when `pickup_location.name` isn't a registered warehouse. */
const UNREGISTERED_PICKUP_RMK = "clientwarehouse matching query does not exist"

/**
 * Throw unless Delhivery actually accepted the manifest.
 *
 * Two independent ways a `/api/cmu/create.json` 200 can still be a failure:
 * a top-level `success: false` (with the reason in `rmk`), and a per-package
 * `status` that isn't `Success` (reason in `remarks`). Both are checked —
 * a partial refusal must not read as a shipment.
 *
 * Pure & exported for unit testing.
 */
export function assertDelhiveryManifestSucceeded(
  body: any,
  pickupLocationName?: string
): void {
  const packages: any[] = Array.isArray(body?.packages) ? body.packages : []
  const failed = packages.find(
    (p) => p?.status && String(p.status).toLowerCase() !== "success"
  )

  const succeeded = body?.success !== false && !failed
  if (succeeded) {
    // A 200 with `success: true` but no package at all is still not a shipment.
    if (!packages.length && !body?.upload_wbn) {
      throw new DelhiveryApiError(
        "Delhivery accepted the request but returned no package or waybill.",
        { raw: body }
      )
    }
    return
  }

  const remark = String(
    body?.rmk ??
      (Array.isArray(failed?.remarks) ? failed.remarks.join("; ") : failed?.remarks) ??
      ""
  ).trim()

  // The overwhelmingly common cause, and the one with a specific remedy: the
  // pickup name must match a registered warehouse EXACTLY and case-sensitively
  // (Delhivery's docs are explicit about this), so a location that was never
  // registered fails every single time until someone registers it.
  if (remark.toLowerCase().includes(UNREGISTERED_PICKUP_RMK)) {
    throw new DelhiveryApiError(
      `Delhivery has no registered pickup warehouse named "${
        pickupLocationName ?? "(none supplied)"
      }". Register this stock location as a Delhivery warehouse, then retry — ` +
        `Delhivery matches the pickup name exactly and is case-sensitive.`,
      { code: "unregistered_pickup", raw: body }
    )
  }

  throw new DelhiveryApiError(
    `Delhivery refused the shipment${remark ? `: ${remark}` : "."}`,
    { raw: body }
  )
}

export class DelhiveryClient {
  private baseUrl: string
  private token: string
  private fetch_: FetchLike

  constructor(options: DelhiveryOptions) {
    this.token = options.api_token
    this.baseUrl = options.sandbox ? STAGING_BASE : PROD_BASE
    this.fetch_ = options.fetchImpl ?? ((input, init) => fetch(input, init as any))
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
    const res = await this.fetch_(
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

    const res = await this.fetch_(url, { headers: this.headers() })

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
    const res = await this.fetch_(`${this.baseUrl}/api/backend/clientwarehouse/create/`, {
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

    const res = await this.fetch_(`${this.baseUrl}/fm/request/new/`, {
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
    const res = await this.fetch_(`${this.baseUrl}/waybill/api/fetch/`, {
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
    /**
     * Declared value of the goods. Distinct from `cod_amount` — a prepaid
     * shipment collects nothing on delivery but still carries value, and
     * omitting this is what made every manifest show as a ₹0 order.
     */
    total_amount?: number
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
      total_amount: shipment.total_amount || 0,
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

    const res = await this.fetch_(`${this.baseUrl}/api/cmu/create.json`, {
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

    // Delhivery reports a REFUSED manifest as HTTP 200 with `success: false`
    // (and the reason in `rmk`), so a status check alone lets a failure through
    // as if it had worked — that is exactly how order #83 came to hold a
    // fulfillment with an empty waybill. Treat the body as the source of truth.
    const body = await res.json()
    assertDelhiveryManifestSucceeded(body, shipment.pickup_location_name)
    return body
  }

  async trackShipment(waybill: string): Promise<any> {
    const res = await this.fetch_(
      `${this.baseUrl}/api/v1/packages/json/?waybill=${waybill}`,
      { headers: this.headers() }
    )
    if (!res.ok) throw new Error(`Delhivery tracking failed (${res.status})`)
    return res.json()
  }

  async getLabel(waybill: string): Promise<any> {
    const res = await this.fetch_(
      `${this.baseUrl}/api/p/packing_slip?wbns=${waybill}`,
      { headers: this.headers() }
    )
    if (!res.ok) throw new Error(`Delhivery label fetch failed (${res.status})`)
    return res.json()
  }

  async cancelShipment(waybill: string): Promise<any> {
    const res = await this.fetch_(`${this.baseUrl}/api/p/edit`, {
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
