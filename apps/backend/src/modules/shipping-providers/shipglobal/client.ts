/**
 * ShipGlobal.in vendor API client (#shipglobal).
 *
 * ShipGlobal (shipglobal.in) is a cross-border courier that ships OUT of India
 * to international destinations. Its published Postman collection
 * (https://documenter.getpostman.com/view/27717351/2s9YXfd4Ky) exposes five
 * JSON endpoints behind HTTP Basic auth:
 *
 *   POST /rates/calculate           { package_weight, country_iso_code_2, postcode }
 *   POST /order/add                 full order → returns a `tracking` number (SG…)
 *   POST /order/getLabel            { tracking, label: true } → pay + fetch label
 *   POST /order/cancelRefundOrder   { tracking }
 *   POST /tools/tracking            { tracking } → awbEvents[] + awbInfo
 *
 * The flow is: createShipment = `order/add` (returns the SG tracking number in
 * ONE call, like Delhivery), then getLabel = `order/getLabel` to pay and pull
 * the label. This client implements our normalized `ShippingProviderClient` so
 * the carrier-keyed resolver (`resolver.ts`) drives it exactly like Shiprocket
 * / Delhivery.
 *
 * Live response shapes (verified against the carrier):
 *   rates/calculate  → { success, billed_weight, currency, services: [{ title,
 *                       notes, transit_time, price: { logistic_fee }, subtotal_fee }] }
 *   order/getLabel   → { success, tracking, label } where `label` is base64 PDF
 *   tools/tracking   → { success, data: { awbEvents[]: { awb_history_datetime,
 *                       awb_history_location, awb_history_comment, awb_event_code },
 *                       awbInfo: { awb_status, awb_sender_name, awb_destination,
 *                       awb_number, awb_postcode, partner_lastmile_display, … } } }
 *
 * ⚠️ The tracking fields are `awb_`-prefixed snake_case — NOT the camelCase the
 * published collection's field table describes. The normalizers read the live
 * snake_case keys (with the documented camelCase as fallback), since the
 * collection's table is aspirational.
 */
import { MedusaError } from "@medusajs/framework/utils"
import {
  CreateShipmentInput,
  LabelResult,
  RateOption,
  RateQuery,
  ShipmentRef,
  ShipmentResult,
  ShippingProviderClient,
  TrackingEvent,
  TrackingResult,
} from "../provider-interface"
import { isInternationalDestination } from "../destination"
import { normalizeHsCode } from "../hs-code-resolution"

const BASE_URL = "https://app.shipglobal.in/apiv1"

/** Default `service` code stamped on a ShipGlobal order. ShipGlobal's service is
 *  a region-specific CODE, not a display name: `sgdirecteuyun` serves EU and
 *  `sgdirectyungb` serves GB. Override per account/region via options (`service`)
 *  or the `SHIPGLOBAL_SERVICE` env var — the resolver passes the configured value
 *  through. */
const DEFAULT_SERVICE = "sgdirecteuyun"

/** The subset of `fetch` the client uses — injectable so tests/CI can supply a
 *  deterministic transport (same pattern as Shiprocket's `FetchLike`, #647). */
export type FetchLike = (input: any, init?: any) => Promise<any>

export type ShipglobalOptions = {
  username: string
  password: string
  /** Service code sent on `order/add`. Region-specific: `sgdirecteuyun` (EU),
   *  `sgdirectyungb` (GB). Defaults to `sgdirecteuyun`. */
  service?: string
  /** Injectable transport (defaults to the global fetch). */
  fetchImpl?: FetchLike
}

/**
 * A ShipGlobal API failure as a first-class MedusaError, mirroring
 * `ShiprocketApiError`. The upstream HTTP status maps onto a MedusaError type so
 * it flows through the framework's error handler with the right code.
 */
export class ShipglobalApiError extends MedusaError {
  readonly status: number
  readonly raw?: unknown

  constructor(
    message: string,
    opts: { status: number; raw?: unknown }
  ) {
    super(ShipglobalApiError.typeForStatus(opts.status), message)
    this.name = "ShipglobalApiError"
    this.status = opts.status
    this.raw = opts.raw
  }

  static typeForStatus(status: number): string {
    if (status === 401 || status === 403) return MedusaError.Types.NOT_ALLOWED
    if (status >= 400 && status < 500) return MedusaError.Types.INVALID_DATA
    return MedusaError.Types.UNEXPECTED_STATE
  }
}

/**
 * Pull a readable message out of a ShipGlobal error body. The collection's error
 * table describes `{ code, message, description }` rows; the raw text is the
 * fallback when the body is not JSON or has no message.
 */
export function parseShipglobalError(raw: string): string {
  let body: any
  try {
    body = raw ? JSON.parse(raw) : undefined
  } catch {
    return raw || ""
  }
  if (body === undefined || body === null) return raw || ""
  if (typeof body === "string") return body
  const msg =
    typeof body.message === "string"
      ? body.message
      : typeof body.error === "string"
        ? body.error
        : typeof body.description === "string"
          ? body.description
          : raw || ""
  return msg
}

/** The AWB/tracking number on a ShipGlobal shipment/order response. Defensive —
 *  the field name is not pinned in the collection, so read every plausible key. */
export function extractTracking(res: any): string {
  const d = res?.data ?? res ?? {}
  const v =
    d.tracking ??
    d.tracking_number ??
    d.tracking_no ??
    d.awb ??
    d.awb_number ??
    d.airwaybill ??
    d.awbNo ??
    ""
  return typeof v === "string" ? v.trim() : v ? String(v).trim() : ""
}

/** Tracking URL for a ShipGlobal SG-number. Constructed; the collection does not
 *  document a public tracking URL, so this is the carrier's own track page. */
export function shipglobalTrackingUrl(tracking: string): string {
  return tracking
    ? `https://app.shipglobal.in/tracking/${encodeURIComponent(tracking)}`
    : ""
}

/** ShipGlobal `SGE_*` event code → our coarse `scan_type`. See the collection's
 *  status-code table: 001/101 = created, 3xx = in transit, 304 = delivered,
 *  4xx/5xx = RTO/exception. */
export function scanTypeForEventCode(code?: string): string {
  const c = String(code || "").toUpperCase()
  if (c === "SGE_304") return "delivered"
  if (c === "SGE_001" || c === "SGE_002" || c === "SGE_101") return "created"
  if (/^SGE_4/.test(c)) return "rto"
  if (/^SGE_5/.test(c)) return "rto"
  if (/^SGERROR/.test(c)) return "exception"
  return "in_transit"
}

/** Build the ShipGlobal `order/add` body from a normalized shipment input.
 *  Pure & exported so the exact payload (invoice fields, address split, item
 *  lines) is unit-testable without a live API. */
export function buildOrderBody(
  input: CreateShipmentInput,
  service: string
): Record<string, any> {
  const [firstName, ...rest] = (input.to.name || "Customer").split(" ")
  const lastName = rest.join(" ")
  const countryCode = String(input.to.country || "").trim().toUpperCase()

  const items = (input.items || []).map((i) => ({
    vendor_order_item_name: i.name,
    vendor_order_item_sku: i.sku || "",
    vendor_order_item_quantity: String(i.quantity || 1),
    vendor_order_item_unit_price: String(i.unit_price || 0),
    vendor_order_item_hsn: normalizeHsCode(i.hsn) || "",
    vendor_order_item_tax_rate: i.tax != null ? String(i.tax) : "0",
  }))

  return {
    invoice_no: input.reference_id,
    invoice_date: new Date().toISOString().slice(0, 10),
    order_reference: input.reference_id,
    service,
    package_weight: String(Math.max(0.001, (input.weight_grams || 0) / 1000)),
    package_length: String(input.dimensions_cm?.length || 10),
    package_breadth: String(input.dimensions_cm?.width || 10),
    package_height: String(input.dimensions_cm?.height || 10),
    currency_code: (input.currency || "USD").toUpperCase(),
    // ShipGlobal is cross-border only; the collection example ships CSB-5 (1).
    csb5_status: 1,
    customer_shipping_firstname: firstName,
    customer_shipping_lastname: lastName,
    customer_shipping_mobile: input.to.phone || "",
    customer_shipping_email: input.to.email || "",
    customer_shipping_company: "",
    customer_shipping_address: input.to.address_1 || "",
    customer_shipping_address_2: input.to.address_2 || "",
    customer_shipping_address_3: "",
    customer_shipping_city: input.to.city || "",
    customer_shipping_postcode: input.to.pincode || "",
    customer_shipping_country_code: countryCode,
    customer_shipping_state: input.to.state || "",
    ioss_number: "",
    vendor_order_items: items,
  }
}

/**
 * Normalize a ShipGlobal tracking payload (`/tools/tracking`) into our
 * `TrackingResult`. Pure & exported so the webhook/normalize path can parse
 * without carrier credentials.
 *
 * ⚠️ The ACTUAL response uses `awb_`-prefixed snake_case (`awb_history_datetime`,
 * `awb_event_code`, `awb_status`), NOT the camelCase the published collection
 * describes (`datetime`, `eventCode`, `status`). The collection's field table is
 * aspirational; the live payload is what's parsed here, with the documented
 * camelCase names kept as a fallback only.
 */
export function normalizeShipglobalTracking(
  payload: any,
  awb: string
): TrackingResult {
  const data = payload?.data ?? {}
  const info = data?.awbInfo ?? {}
  const events: TrackingEvent[] = (Array.isArray(data?.awbEvents)
    ? data.awbEvents
    : []
  ).map((e: any) => ({
    timestamp:
      e?.awb_history_datetime ?? e?.datetime ?? "",
    status:
      e?.awb_history_comment ?? e?.comment ?? e?.type ?? e?.eventCode ?? "",
    location: e?.awb_history_location ?? e?.location ?? "",
    scan_type: scanTypeForEventCode(e?.awb_event_code ?? e?.eventCode),
  }))

  return {
    carrier: "shipglobal",
    awb,
    current_status:
      info?.awb_status ??
      info?.status ??
      info?.partner_lastmile_display ??
      "",
    current_status_code: info?.awb_status ?? info?.status ?? undefined,
    estimated_delivery: null,
    origin: (info?.awb_sender_name ?? info?.senderName) || undefined,
    destination: (info?.awb_destination ?? info?.destination) || undefined,
    events,
    raw: payload,
  }
}

/** Coerce a carrier-quoted charge into a finite number, or undefined. A blank or
 *  unparseable value must NOT become 0 — zero is a real (free) rate. */
export function toRate(v: unknown): number | undefined {
  if (v === null || v === undefined || v === "") return undefined
  const n = Number(v)
  return Number.isFinite(n) ? n : undefined
}

/** Parse a ShipGlobal `transit_time` string ("7-10 Days", "4 - 7 Days") into the
 *  high end of the range — the delivery promise we'd show a customer. */
export function parseTransitDays(v: unknown): number | undefined {
  const text = String(v ?? "")
    .split(/[-–]/)
    .pop()
    ?.trim()
  if (!text) return undefined
  const n = Number(text.replace(/[^0-9]/g, ""))
  return Number.isFinite(n) && n > 0 ? n : undefined
}

/**
 * Normalize a ShipGlobal `rates/calculate` response into `RateOption[]`.
 *
 * The live response is `{ success, billed_weight, currency, services: [{ title,
 * notes, transit_time, price: { logistic_fee }, subtotal_fee }] }` — one row per
 * service. `subtotal_fee` is the customer-facing total; `price.logistic_fee` is
 * the freight component. The first row is treated as the recommended (cheapest)
 * option since ShipGlobal returns no explicit recommended flag.
 */
export function normalizeShipglobalRates(res: any): RateOption[] {
  const currency = String(
    res?.currency ?? res?.data?.currency ?? "USD"
  ).toLowerCase()
  const services = res?.services ?? res?.data?.services ?? []
  if (!Array.isArray(services)) return []
  return services
    .map((s: any, i: number): RateOption | undefined => {
      const amount = toRate(s?.subtotal_fee) ?? toRate(s?.price?.logistic_fee)
      if (amount === undefined) return undefined
      return {
        courier_id: s?.title,
        courier_name: s?.title,
        amount,
        currency_code: currency,
        estimated_days: parseTransitDays(s?.transit_time),
        is_recommended: i === 0,
      }
    })
    .filter((r): r is RateOption => r !== undefined)
}

export class ShipglobalClient implements ShippingProviderClient {
  readonly carrier = "shipglobal"

  private username: string
  private password: string
  private service: string
  private authHeader: string
  private fetchImpl: FetchLike

  constructor(options: ShipglobalOptions) {
    this.username = options.username
    this.password = options.password
    this.service = options.service || DEFAULT_SERVICE
    this.authHeader = `Basic ${Buffer.from(
      `${options.username}:${options.password}`
    ).toString("base64")}`
    this.fetchImpl =
      options.fetchImpl ?? ((input, init) => globalThis.fetch(input, init))
  }

  private async request<T = any>(
    path: string,
    body?: unknown
  ): Promise<T> {
    const res = await this.fetchImpl(`${BASE_URL}${path}`, {
      method: "POST",
      headers: {
        Authorization: this.authHeader,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const raw = await res.text().catch(() => "")
    let json: any
    try {
      json = raw ? JSON.parse(raw) : {}
    } catch {
      json = undefined
    }
    if (!res.ok) {
      const message = parseShipglobalError(raw)
      throw new ShipglobalApiError(
        `ShipGlobal ${path} failed (${res.status})${message ? ` — ${message}` : ""}`,
        { status: res.status, raw }
      )
    }
    return json as T
  }

  /**
   * Rates for a lane. ShipGlobal is cross-border only, so this refuses a
   * domestic (India) destination rather than posting an Indian postcode to a
   * country-keyed rate API.
   */
  async getRates(query: RateQuery): Promise<RateOption[]> {
    if (!isInternationalDestination(query.destination_country)) {
      return []
    }
    const res = await this.request<Record<string, any>>(`/rates/calculate`, {
      package_weight: String(
        Math.max(0.001, (query.weight_grams || 0) / 1000)
      ),
      country_iso_code_2: String(query.destination_country || "").toUpperCase(),
      postcode: query.destination_pincode || "",
    })
    return normalizeShipglobalRates(res)
  }

  /**
   * Create the shipment (`order/add`), which returns the SG tracking number in a
   * single call — no separate AWB-assignment step like Shiprocket.
   */
  async createShipment(input: CreateShipmentInput): Promise<ShipmentResult> {
    if (!isInternationalDestination(input.to.country)) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "ShipGlobal is cross-border only and cannot ship a domestic (India) destination"
      )
    }
    const res = await this.request<Record<string, any>>(
      `/order/add`,
      buildOrderBody(input, this.service)
    )
    const tracking = extractTracking(res)
    if (!tracking) {
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        `ShipGlobal order created but returned no tracking number: ${JSON.stringify(res)}`
      )
    }
    return {
      carrier: this.carrier,
      awb: tracking,
      tracking_number: tracking,
      tracking_url: shipglobalTrackingUrl(tracking),
      provider_refs: { tracking },
      raw: res,
    }
  }

  async getLabel(ref: ShipmentRef): Promise<LabelResult> {
    const tracking = refTracking(ref)
    if (!tracking) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "ShipGlobal getLabel requires a tracking number"
      )
    }
    const res = await this.request<Record<string, any>>(`/order/getLabel`, {
      tracking,
      label: true,
    })
    const d = res?.data ?? res ?? {}
    const labelUrl =
      typeof d.label_url === "string"
        ? d.label_url
        : typeof d.label === "string" && /^https?:/.test(d.label)
          ? d.label
          : typeof d.url === "string"
            ? d.url
            : ""
    return {
      label_url: labelUrl || undefined,
      data:
        typeof d.label === "string" && !/^https?:/.test(d.label)
          ? d.label
          : undefined,
      format: "pdf",
      raw: res,
    }
  }

  async track(ref: ShipmentRef): Promise<TrackingResult> {
    const tracking = refTracking(ref)
    if (!tracking) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "ShipGlobal track requires a tracking number"
      )
    }
    const res = await this.request<Record<string, any>>(`/tools/tracking`, {
      tracking,
    })
    return normalizeShipglobalTracking(res, tracking)
  }

  async cancelShipment(
    ref: ShipmentRef
  ): Promise<{ success: boolean; raw?: any }> {
    const tracking = refTracking(ref)
    if (!tracking) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "ShipGlobal cancelShipment requires a tracking number"
      )
    }
    const res = await this.request<Record<string, any>>(
      `/order/cancelRefundOrder`,
      { tracking }
    )
    return { success: true, raw: res }
  }
}

/** The tracking/AWB number on a persisted shipment ref, from whichever key the
 *  resolver/framework stashed it. */
function refTracking(ref: ShipmentRef): string {
  const v =
    ref?.awb ??
    ref?.provider_refs?.tracking ??
    ref?.provider_refs?.waybill ??
    ref?.provider_refs?.awb ??
    ""
  return String(v || "").trim()
}