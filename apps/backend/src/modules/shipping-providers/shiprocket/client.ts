/**
 * Shiprocket API client (#31).
 *
 * Adapted from the MIT-licensed SAM-AEL/medusa-plugin-shiprocket, rewritten to
 * use native `fetch` (matching DelhiveryClient — no axios dep) and our
 * normalized ShippingProviderClient interface. Implements the multi-step
 * Shiprocket flow (create → assign-AWB → label) behind the single
 * `createShipment` capability.
 *
 * Docs: https://apidocs.shiprocket.in/  ·  base: https://apiv2.shiprocket.in/v1/external
 */
import {
  CreateShipmentInput,
  LabelResult,
  PickupLocation,
  RateOption,
  RateQuery,
  RegisterPickupLocationInput,
  SchedulePickupInput,
  SchedulePickupResult,
  ShipmentRef,
  ShipmentResult,
  ShippingProviderClient,
  TrackingEvent,
  TrackingResult,
} from "../provider-interface"

const BASE_URL = "https://apiv2.shiprocket.in/v1/external"

export type ShiprocketOptions = {
  email: string
  password: string
  /** Default registered pickup-location name when a shipment doesn't carry one. */
  pickup_location?: string
  /** Inject a token to skip the login round-trip (e.g. cached). */
  token?: string
}

/**
 * Error carrying the parsed Shiprocket response so callers can surface the
 * field-level validation messages instead of an opaque 500 (#427).
 */
export class ShiprocketApiError extends Error {
  readonly status: number
  readonly fieldErrors?: Record<string, string[]>
  readonly raw?: unknown

  constructor(
    message: string,
    opts: { status: number; fieldErrors?: Record<string, string[]>; raw?: unknown }
  ) {
    super(message)
    this.name = "ShiprocketApiError"
    this.status = opts.status
    this.fieldErrors = opts.fieldErrors
    this.raw = opts.raw
  }
}

/**
 * Pull a readable message (and per-field errors) out of a Shiprocket error
 * body. Shiprocket uses several shapes:
 *   "Invalid email and password combination"        (plain string)
 *   { message: "...", status_code }                  (flat)
 *   { message: { field: ["msg", ...], ... } }        (422 validation — addpickup)
 *   { errors: { field: ["msg", ...] } }
 */
export function parseShiprocketError(raw: string): {
  message: string
  fieldErrors?: Record<string, string[]>
} {
  let body: any
  try {
    body = raw ? JSON.parse(raw) : undefined
  } catch {
    return { message: raw || "" }
  }
  if (body === undefined || body === null) return { message: raw || "" }
  if (typeof body === "string") return { message: body }

  // Validation bag: { message: {field: [...]}} or { errors: {field: [...]} }.
  const bag =
    body.message && typeof body.message === "object"
      ? body.message
      : body.errors && typeof body.errors === "object"
        ? body.errors
        : undefined
  if (bag) {
    const fieldErrors: Record<string, string[]> = {}
    const parts: string[] = []
    for (const [field, val] of Object.entries(bag)) {
      const msgs = Array.isArray(val) ? val.map(String) : [String(val)]
      fieldErrors[field] = msgs
      parts.push(`${field}: ${msgs.join("; ")}`)
    }
    return { message: parts.join(" | "), fieldErrors }
  }

  const msg =
    typeof body.message === "string"
      ? body.message
      : typeof body.error === "string"
        ? body.error
        : raw || ""
  return { message: msg }
}

/** Shiprocket numeric shipment_status_id → coarse scan_type. */
function scanTypeForStatus(id?: number): string {
  switch (id) {
    case 7:
      return "delivered"
    case 6:
    case 42:
      return "shipped"
    case 9:
    case 10:
      return "rto"
    case 1:
    case 5:
      return "created"
    default:
      return "in_transit"
  }
}

export class ShiprocketClient implements ShippingProviderClient {
  readonly carrier = "shiprocket"

  private email: string
  private password: string
  private defaultPickup?: string
  private token?: string

  constructor(options: ShiprocketOptions) {
    this.email = options.email
    this.password = options.password
    this.defaultPickup = options.pickup_location
    this.token = options.token
  }

  /** Authenticate (or reuse an injected token). Token TTL is ~10 days. */
  private async authenticate(force = false): Promise<string> {
    if (this.token && !force) return this.token
    const res = await fetch(`${BASE_URL}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: this.email, password: this.password }),
    })
    if (!res.ok) {
      const raw = await res.text().catch(() => "")
      const { message, fieldErrors } = parseShiprocketError(raw)
      throw new ShiprocketApiError(
        `Shiprocket auth failed (${res.status})${message ? ` — ${message}` : ""}`,
        { status: res.status, fieldErrors, raw }
      )
    }
    const json = await res.json()
    if (!json?.token) throw new Error("Shiprocket auth returned no token")
    this.token = json.token
    return this.token!
  }

  /**
   * Authenticated request with one transparent re-login on 401 (token expiry).
   */
  private async request<T = any>(
    path: string,
    init: RequestInit = {},
    retryOn401 = true
  ): Promise<T> {
    const token = await this.authenticate()
    const res = await fetch(`${BASE_URL}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        ...(init.headers || {}),
      },
    })

    if (res.status === 401 && retryOn401) {
      await this.authenticate(true)
      return this.request<T>(path, init, false)
    }
    if (!res.ok) {
      const raw = await res.text().catch(() => "")
      const { message, fieldErrors } = parseShiprocketError(raw)
      throw new ShiprocketApiError(
        `Shiprocket ${path} failed (${res.status})${message ? ` — ${message}` : ""}`,
        { status: res.status, fieldErrors, raw }
      )
    }
    return res.json() as Promise<T>
  }

  async checkServiceability(destinationPincode: string): Promise<boolean> {
    // Serviceability needs an origin; without one we can only confirm the API
    // responds. Callers that have an origin should use getRates instead.
    if (!this.defaultPickup) return true
    return true
  }

  async getRates(query: RateQuery): Promise<RateOption[]> {
    const qs = new URLSearchParams({
      pickup_postcode: query.origin_pincode,
      delivery_postcode: query.destination_pincode,
      weight: String(Math.max(0.01, query.weight_grams / 1000)),
      cod: query.cod ? "1" : "0",
    })
    if (query.dimensions_cm) {
      qs.set("length", String(query.dimensions_cm.length))
      qs.set("breadth", String(query.dimensions_cm.width))
      qs.set("height", String(query.dimensions_cm.height))
    }
    const json = await this.request<any>(`/courier/serviceability/?${qs}`, {
      method: "GET",
    })
    const couriers = json?.data?.available_courier_companies || []
    const recommended = json?.data?.recommended_courier_company_id
    return couriers.map((c: any) => ({
      courier_id: c.courier_company_id,
      courier_name: c.courier_name,
      amount: Number(c.rate) || 0,
      currency_code: "inr",
      estimated_days: c.estimated_delivery_days
        ? Number(c.estimated_delivery_days)
        : undefined,
      cod_charges: c.cod_charges ? Number(c.cod_charges) : undefined,
      is_recommended: c.courier_company_id === recommended,
    }))
  }

  /**
   * Create order → assign AWB → generate label, returning a uniform result.
   * Shiprocket separates these; we sequence them so the caller gets an AWB +
   * label in one call, mirroring Delhivery's single-call shape.
   */
  async createShipment(input: CreateShipmentInput): Promise<ShipmentResult> {
    const pickup = input.pickup_location_name || this.defaultPickup
    if (!pickup) {
      throw new Error("Shiprocket createShipment requires a pickup_location_name")
    }

    const [firstName, ...rest] = (input.to.name || "Customer").split(" ")
    const lastName = rest.join(" ")
    const subTotal =
      input.sub_total ??
      input.items.reduce((s, i) => s + i.unit_price * i.quantity, 0)

    // 1) Create the adhoc order.
    const createBody = {
      order_id: input.reference_id,
      order_date: new Date().toISOString().slice(0, 16).replace("T", " "),
      pickup_location: pickup,
      billing_customer_name: firstName,
      billing_last_name: lastName,
      billing_address: input.to.address_1,
      billing_address_2: input.to.address_2 || "",
      billing_city: input.to.city,
      billing_pincode: input.to.pincode,
      billing_state: input.to.state,
      billing_country: input.to.country || "India",
      billing_email: input.to.email || "",
      billing_phone: input.to.phone,
      shipping_is_billing: true,
      order_items: input.items.map((i) => ({
        name: i.name,
        sku: i.sku || i.name,
        units: i.quantity,
        selling_price: i.unit_price,
        hsn: i.hsn || "",
        tax: i.tax ?? "",
      })),
      payment_method: input.payment_mode === "cod" ? "COD" : "Prepaid",
      sub_total: subTotal,
      length: input.dimensions_cm?.length || 10,
      breadth: input.dimensions_cm?.width || 10,
      height: input.dimensions_cm?.height || 10,
      weight: Math.max(0.01, input.weight_grams / 1000),
    }

    const created = await this.request<any>(`/orders/create/adhoc`, {
      method: "POST",
      body: JSON.stringify(createBody),
    })

    const srOrderId = created?.order_id
    const shipmentId = created?.shipment_id
    if (!shipmentId) {
      throw new Error(
        `Shiprocket order created but returned no shipment_id: ${JSON.stringify(created)}`
      )
    }

    // 2) Assign an AWB (force a courier if the caller picked one).
    const assignBody: Record<string, any> = { shipment_id: [shipmentId] }
    if (input.preferred_courier_id) {
      assignBody.courier_id = input.preferred_courier_id
    }
    const assigned = await this.request<any>(`/courier/assign/awb`, {
      method: "POST",
      body: JSON.stringify(assignBody),
    })
    const awbData = assigned?.response?.data || {}
    const awb = awbData.awb_code || ""

    // 3) Generate the label (best-effort — may not be ready instantly).
    let labelUrl = ""
    try {
      const label = await this.request<any>(`/courier/generate/label`, {
        method: "POST",
        body: JSON.stringify({ shipment_id: [shipmentId] }),
      })
      labelUrl = label?.label_url || ""
    } catch {
      // Label can be fetched later via getLabel(); don't fail the shipment.
    }

    return {
      carrier: this.carrier,
      awb,
      tracking_number: awb,
      tracking_url: awb ? `https://shiprocket.co/tracking/${awb}` : undefined,
      label_url: labelUrl || undefined,
      provider_refs: {
        sr_order_id: srOrderId,
        shipment_id: shipmentId,
        courier_company_id: awbData.courier_company_id,
        courier_name: awbData.courier_name,
      },
      raw: { created, assigned },
    }
  }

  async getLabel(ref: ShipmentRef): Promise<LabelResult> {
    const shipmentId = ref.provider_refs?.shipment_id
    if (!shipmentId) {
      throw new Error("Shiprocket getLabel requires provider_refs.shipment_id")
    }
    const json = await this.request<any>(`/courier/generate/label`, {
      method: "POST",
      body: JSON.stringify({ shipment_id: [shipmentId] }),
    })
    return { label_url: json?.label_url || undefined, format: "PDF", raw: json }
  }

  async track(ref: ShipmentRef): Promise<TrackingResult> {
    let json: any
    if (ref.awb) {
      json = await this.request<any>(`/courier/track/awb/${ref.awb}`, {
        method: "GET",
      })
    } else if (ref.provider_refs?.shipment_id) {
      json = await this.request<any>(
        `/courier/track/shipment/${ref.provider_refs.shipment_id}`,
        { method: "GET" }
      )
    } else {
      throw new Error("Shiprocket track requires an awb or shipment_id")
    }
    return this.normalizeTracking(json?.tracking_data || json)
  }

  async cancelShipment(ref: ShipmentRef): Promise<{ success: boolean; raw?: any }> {
    const srOrderId = ref.provider_refs?.sr_order_id
    if (!srOrderId) {
      throw new Error("Shiprocket cancelShipment requires provider_refs.sr_order_id")
    }
    const json = await this.request<any>(`/orders/cancel`, {
      method: "POST",
      body: JSON.stringify({ ids: [srOrderId] }),
    })
    return { success: true, raw: json }
  }

  async schedulePickup(input: SchedulePickupInput): Promise<SchedulePickupResult> {
    const shipmentId = input.ref?.provider_refs?.shipment_id
    if (!shipmentId) {
      throw new Error("Shiprocket schedulePickup requires ref.provider_refs.shipment_id")
    }
    const json = await this.request<any>(`/courier/generate/pickup`, {
      method: "POST",
      body: JSON.stringify({ shipment_id: [shipmentId] }),
    })
    return {
      scheduled_date: json?.response?.pickup_scheduled_date,
      token: json?.response?.pickup_token_number
        ? String(json.response.pickup_token_number)
        : undefined,
      raw: json,
    }
  }

  async registerPickupLocation(
    input: RegisterPickupLocationInput
  ): Promise<{ name: string; raw?: any }> {
    const json = await this.request<any>(`/settings/company/addpickup`, {
      method: "POST",
      body: JSON.stringify({
        pickup_location: input.name,
        name: input.name,
        // Shiprocket rejects an empty email (422). Fall back to the account
        // email so registration always has a valid contact (#427).
        email: input.email || this.email,
        phone: input.phone,
        address: input.address_1,
        address_2: input.address_2 || "",
        city: input.city,
        state: input.state,
        country: input.country || "India",
        pin_code: input.pincode,
        gstin: input.gstin || "",
      }),
    })
    return { name: input.name, raw: json }
  }

  /**
   * List registered pickup locations (`data.shipping_address[]`). Used for
   * idempotent registration and to surface phone-verification status — a
   * Shiprocket pickup point isn't usable for live pickups until its phone is
   * OTP-verified, so "registered" ≠ "shippable".
   */
  async listPickupLocations(): Promise<PickupLocation[]> {
    const json = await this.request<any>(`/settings/company/pickup`, {
      method: "GET",
    })
    const rows = json?.data?.shipping_address || []
    return rows.map((r: any) => ({
      name: r.pickup_location || r.name || "",
      id: r.id,
      // Shiprocket returns 0/1; treat truthy non-zero as verified.
      phone_verified:
        r.phone_verified !== undefined
          ? Boolean(Number(r.phone_verified))
          : undefined,
      city: r.city,
      state: r.state,
      pincode: r.pin_code,
      raw: r,
    }))
  }

  /** Normalize the Shiprocket webhook push payload (P2). */
  normalizeWebhook(payload: any): TrackingResult {
    const events: TrackingEvent[] = (payload?.scans || []).map((s: any) => ({
      timestamp: s.date,
      status: s.status || s["sr-status-label"] || "",
      location: s.location || "",
      scan_type: scanTypeForStatus(Number(payload?.shipment_status_id)),
    }))
    return {
      carrier: this.carrier,
      awb: payload?.awb || "",
      current_status: payload?.current_status || payload?.shipment_status || "",
      current_status_code: payload?.shipment_status_id,
      estimated_delivery: payload?.etd || null,
      events,
      raw: payload,
    }
  }

  private normalizeTracking(data: any): TrackingResult {
    const track = data?.shipment_track?.[0] || {}
    const activities = data?.shipment_track_activities || []
    const events: TrackingEvent[] = activities.map((a: any) => ({
      timestamp: a.date,
      status: a.status || a["sr-status-label"] || "",
      location: a.location || "",
      scan_type: scanTypeForStatus(Number(a["sr-status"])),
    }))
    return {
      carrier: this.carrier,
      awb: track.awb || "",
      current_status: track.current_status || track.shipment_status || "",
      current_status_code: track.shipment_status_id,
      estimated_delivery: track.etd || null,
      origin: track.origin || undefined,
      destination: track.destination || undefined,
      events,
      raw: data,
    }
  }
}
