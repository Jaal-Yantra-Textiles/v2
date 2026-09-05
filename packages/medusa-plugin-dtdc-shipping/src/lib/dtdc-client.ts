import { MedusaError } from "@medusajs/framework/utils"
import {
  DtdcOptions,
  DtdcFetchLike,
  DtdcBookingRequest,
  DtdcBookingResponse,
  DtdcCancelRequest,
  DtdcCancelResponse,
  DtdcPincodeResponse,
  DtdcTrackingRequest,
  DtdcTrackingResponse,
  DtdcServiceType,
  DtdcLoadType,
  DtdcConsignmentType,
  DtdcAddress,
} from "./types"
import {
  DTDC_DEFAULT_COMMODITY_ID,
  resolveDtdcCommodityId,
} from "./commodities"

const SANDBOX_BOOKING_BASE = "https://alphademodashboardapi.shipsy.io"
const LIVE_BOOKING_BASE = "https://pxapi.dtdc.in"
const SANDBOX_TRACKING_AUTH_BASE = "https://dtdcstagingapi.dtdc.com"
const LIVE_TRACKING_AUTH_BASE = "https://blktracksvc.dtdc.com"
// The staging tracking host nests the JSON tracking API under an extra
// "dtdc-tracking-api" segment, unlike live ("blktracksvc") which serves it
// straight off "dtdc-api". Both are full path prefixes up to /rest/….
const SANDBOX_TRACKING_BASE = "https://dtdcstagingapi.dtdc.com/dtdc-tracking-api/dtdc-api"
const LIVE_TRACKING_BASE = "https://blktracksvc.dtdc.com/dtdc-api"
// The rate-calculator host is hyphenated ("smarttrack-ctbsplus") — the
// un-hyphenated HTTPS host answers 200 with an empty body.
const PINCODE_BASE = "https://smarttrack-ctbsplus.dtdc.com"

export class DtdcApiError extends MedusaError {
  readonly code?: string
  readonly raw?: any

  constructor(message: string, opts?: { code?: string; raw?: any }) {
    super(MedusaError.Types.INVALID_DATA, message)
    this.code = opts?.code
    this.raw = opts?.raw
  }
}

function sanitizeAddress(value: string): string {
  return value.replace(/[&\#%;\\]/g, " ").replace(/\s+/g, " ").trim()
}

/** True when DTDC reports the destination pincode serviceable for B2C. */
export function isPincodeServiceable(res: DtdcPincodeResponse | any): boolean {
  const zip = res?.ZIPCODE_RESP?.[0]
  const serv = res?.SERV_LIST?.[0]
  const servCod = String(zip?.SERV_COD ?? "").trim().toUpperCase() === "Y"
  const b2c = String(serv?.b2C_SERVICEABLE ?? "").trim().toUpperCase() === "YES"
  return servCod || b2c
}

/**
 * Map a DTDC tracking scan to the coarse scan_type the tracking sync switches
 * on. DTDC codes are three-letter ("SPL", "PCSC", "PCAW", "DLD", …) and the
 * free-text `strAction` is the reliable human signal.
 */
export function dtdcScanType(
  statusCode?: string | null,
  statusText?: string | null
): string {
  const code = String(statusCode || "").trim().toUpperCase()
  if (code === "DLD" || code === "DD") return "delivered"
  if (code === "RTO" || code === "RT") return "rto"

  const text = String(statusText || "").trim().toLowerCase()
  if (text.includes("delivered")) return "delivered"
  if (text.includes("rto") || text.includes("return")) return "rto"
  if (text.includes("booked") || text.includes("manifest") || text.includes("softdata")) {
    return "created"
  }
  if (text.includes("pickup") || text.includes("picked")) return "picked_up"
  if (text.includes("out for delivery")) return "shipped"
  if (text.includes("in transit") || text.includes("in-transit")) return "in_transit"
  return "in_transit"
}

/**
 * Normalize a DTDC tracking-push payload into a TrackingResult-like shape.
 *
 * Pure and exported so the inbound webhook route can parse a push without
 * carrier credentials, same as normalizeDelhiveryWebhook.
 */
export function normalizeDtdcWebhook(payload: any): {
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
  const header = payload?.trackHeader ?? payload?.TrackHeader ?? payload ?? {}
  const awb =
    header?.strShipmentNo ??
    payload?.strShipmentNo ??
    payload?.awb_no ??
    payload?.reference_number ??
    ""
  const status = header?.strStatus ?? payload?.strStatus ?? ""
  const events = (payload?.trackDetails ?? payload?.TrackDetails ?? []).map(
    (e: any) => {
      const actionDate = e?.strActionDate ?? e?.strScanDate ?? ""
      const actionTime = e?.strActionTime ?? e?.strScanTime ?? ""
      return {
        timestamp: actionDate ? `${actionDate} ${actionTime}`.trim() : "",
        status: e?.strAction ?? e?.strScan ?? "",
        location: e?.strOrigin ?? e?.strLocation ?? "",
        scan_type: dtdcScanType(e?.strCode ?? e?.strStatusCode, e?.strAction ?? e?.strScan),
      }
    }
  )
  return {
    carrier: "dtdc",
    awb: String(awb || ""),
    current_status: String(status || ""),
    current_status_code: header?.strCNProduct || undefined,
    estimated_delivery: header?.strExpectedDeliveryDate ?? null,
    events,
    raw: payload,
  }
}

/**
 * Throw unless DTDC actually accepted every consignment in the booking.
 *
 * DTDC's /softdata returns HTTP 200 with `data[].success: false` (and the
 * reason in `message` / `reason`) on refusal, so a status check alone lets a
 * failure through as if it had worked.
 */
export function assertDtdcBookingSucceeded(body: any): void {
  const entries: any[] = Array.isArray(body?.data) ? body.data : []
  if (!entries.length) {
    throw new DtdcApiError(
      "DTDC accepted the request but returned no consignment data.",
      { raw: body }
    )
  }
  const failed = entries.find((e) => e?.success === false)
  if (failed) {
    const detail =
      failed?.message ||
      failed?.reason ||
      (failed?.success === false ? "consignment refused" : "unknown")
    throw new DtdcApiError(`DTDC booking failed: ${detail}`, { raw: body })
  }
}

export class DtdcClient {
  private bookingBase: string
  private trackingAuthBase: string
  private trackingBase: string
  private customerCode: string
  private apiKey: string
  private trackingUsername: string
  private trackingPassword: string
  private trackingAccessToken: string | null
  private defaultServiceType: DtdcServiceType
  private defaultCommodityId: string
  private fetch_: DtdcFetchLike

  constructor(options: DtdcOptions) {
    this.customerCode = options.customer_code
    this.apiKey = options.api_key
    this.trackingUsername = options.tracking_username ?? ""
    this.trackingPassword = options.tracking_password ?? ""
    this.trackingAccessToken = options.tracking_access_token ?? null
    this.defaultServiceType = options.default_service_type ?? "PRIORITY"
    /**
     * 🔴 Resolved once, and NOT silently defaulted to the old `"2"` (MOBILE).
     * An unrecognised configured value falls to CLOTHING rather than to a
     * number nobody chose — a wrong commodity is a mis-declared parcel.
     */
    this.defaultCommodityId =
      resolveDtdcCommodityId(options.default_commodity_id) ??
      DTDC_DEFAULT_COMMODITY_ID

    if (options.sandbox) {
      this.bookingBase = SANDBOX_BOOKING_BASE
      this.trackingAuthBase = SANDBOX_TRACKING_AUTH_BASE
      this.trackingBase = SANDBOX_TRACKING_BASE
    } else {
      this.bookingBase = LIVE_BOOKING_BASE
      this.trackingAuthBase = LIVE_TRACKING_AUTH_BASE
      this.trackingBase = LIVE_TRACKING_BASE
    }

    this.fetch_ = options.fetchImpl ?? ((input, init) => fetch(input, init as any))
  }

  private bookingHeaders(): Record<string, string> {
    return {
      "api-key": this.apiKey,
      "Content-Type": "application/json",
    }
  }

  private async safeJson(res: any): Promise<any> {
    const text = await res.text()
    try {
      return JSON.parse(text)
    } catch {
      return { raw: text }
    }
  }

  /**
   * Check pincode serviceability between origin and destination.
   *
   * POST https://smarttrack-ctbsplus.dtdc.com/ratecalapi/PincodeApiCall
   * Body: { orgPincode, desPincode }
   */
  async checkPincodeServiceability(
    originPincode: string,
    destinationPincode: string
  ): Promise<DtdcPincodeResponse> {
    const res = await this.fetch_(
      `${PINCODE_BASE}/ratecalapi/PincodeApiCall`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orgPincode: originPincode,
          desPincode: destinationPincode,
        }),
      }
    )
    if (!res.ok) {
      throw new Error(`DTDC pincode check failed (${res.status})`)
    }
    return res.json()
  }

  /**
   * Create a shipment / book a consignment with DTDC.
   *
   * POST {bookingBase}/api/customer/integration/consignment/softdata
   * Auth: api-key header
   */
  async createShipment(params: {
    service_type_id?: DtdcServiceType
    load_type?: DtdcLoadType
    consignment_type?: DtdcConsignmentType
    length: number
    width: number
    height: number
    weight: number
    declared_value: number
    num_pieces?: number
    origin: DtdcAddress
    destination: DtdcAddress
    return_details?: DtdcAddress
    customer_reference_number: string
    cod_collection_mode?: string
    cod_amount?: number
    commodity_id?: string
    description?: string
    eway_bill?: string
    invoice_number?: string
    invoice_date?: string
    reference_number?: string
  }): Promise<DtdcBookingResponse> {
    const consignment = {
      customer_code: this.customerCode,
      service_type_id: params.service_type_id ?? this.defaultServiceType,
      load_type: params.load_type ?? "NON-DOCUMENT",
      consignment_type: params.consignment_type ?? "Forward",
      dimension_unit: "cm",
      length: String(params.length),
      width: String(params.width),
      height: String(params.height),
      weight_unit: "kg",
      weight: String(params.weight),
      declared_value: String(params.declared_value),
      eway_bill: params.eway_bill ?? "",
      invoice_number: params.invoice_number ?? "",
      invoice_date: params.invoice_date ?? "",
      num_pieces: String(params.num_pieces ?? 1),
      origin_details: {
        name: params.origin.name,
        phone: params.origin.phone,
        alternate_phone: params.origin.alternate_phone ?? "",
        address_line_1: sanitizeAddress(params.origin.address_line_1),
        address_line_2: params.origin.address_line_2 ?? "",
        pincode: params.origin.pincode,
        city: params.origin.city,
        state: params.origin.state,
      },
      destination_details: {
        name: params.destination.name,
        phone: params.destination.phone,
        alternate_phone: params.destination.alternate_phone ?? "",
        address_line_1: sanitizeAddress(params.destination.address_line_1),
        address_line_2: params.destination.address_line_2 ?? "",
        pincode: params.destination.pincode,
        city: params.destination.city,
        state: params.destination.state,
      },
      ...(params.return_details
        ? {
            return_details: {
              name: params.return_details.name,
              phone: params.return_details.phone,
              alternate_phone: params.return_details.alternate_phone ?? "",
              address_line_1: sanitizeAddress(params.return_details.address_line_1),
              address_line_2: params.return_details.address_line_2 ?? "",
              pincode: params.return_details.pincode,
              city: params.return_details.city,
              state: params.return_details.state,
              country: params.return_details.country ?? "India",
              email: params.return_details.email ?? "",
            },
          }
        : {}),
      customer_reference_number: params.customer_reference_number,
      cod_collection_mode: params.cod_collection_mode ?? "",
      cod_amount: params.cod_amount != null ? String(params.cod_amount) : "",
      commodity_id:
        resolveDtdcCommodityId(params.commodity_id) ?? this.defaultCommodityId,
      description: params.description ?? "",
      reference_number: params.reference_number ?? "",
    }

    const body: DtdcBookingRequest = { consignments: [consignment] }

    const res = await this.fetch_(
      `${this.bookingBase}/api/customer/integration/consignment/softdata`,
      {
        method: "POST",
        headers: this.bookingHeaders(),
        body: JSON.stringify(body),
      }
    )

    if (!res.ok) {
      const text = await res.text().catch(() => "")
      throw new Error(`DTDC shipment creation failed (${res.status}): ${text}`)
    }

    const json = await this.safeJson(res)
    assertDtdcBookingSucceeded(json)
    return json
  }

  /**
   * Fetch a shipping label as a PDF stream.
   *
   * GET {bookingBase}/api/customer/integration/consignment/shippinglabel/stream
   *    ?reference_number=<awb>&label_code=SHIP_LABEL_4X6&label_format=pdf
   * Auth: api-key header
   *
   * Returns base64-encoded PDF data. On a JSON error response (label not ready
   * or the environment does not stream labels) the error is surfaced.
   */
  async getLabel(
    awbNumber: string,
    labelCode: string = "SHIP_LABEL_4X6",
    labelFormat: string = "pdf"
  ): Promise<{ data: string; format: string; raw?: any }> {
    const url = `${this.bookingBase}/api/customer/integration/consignment/shippinglabel/stream?reference_number=${encodeURIComponent(awbNumber)}&label_code=${labelCode}&label_format=${labelFormat}`

    const res = await this.fetch_(url, {
      method: "GET",
      headers: this.bookingHeaders(),
    })

    if (!res.ok) {
      const text = await res.text().catch(() => "")
      let detail = text
      try {
        const json = JSON.parse(text)
        detail = json?.error?.message || json?.message || text
      } catch {
        /* not JSON */
      }
      throw new DtdcApiError(`DTDC label fetch failed (${res.status}): ${detail}`)
    }

    const contentType = String(res.headers?.get?.("content-type") || "")
    if (contentType.includes("application/json")) {
      const json = await res.json().catch(() => null)
      throw new DtdcApiError(
        `DTDC label response was JSON (not a PDF): ${json?.error?.message || json?.message || JSON.stringify(json)}`,
        { raw: json }
      )
    }

    const arrayBuffer = await res.arrayBuffer()
    return {
      data: Buffer.from(arrayBuffer).toString("base64"),
      format: labelFormat,
    }
  }

  /**
   * Cancel a shipment / consignment.
   *
   * POST {bookingBase}/api/customer/integration/consignment/cancel
   * Auth: api-key header
   * Body: { AWBNo: ["<awb>"], customerCode: "<code>" }
   */
  async cancelShipment(awbNumber: string): Promise<DtdcCancelResponse> {
    const body: DtdcCancelRequest = {
      AWBNo: [awbNumber],
      customerCode: this.customerCode,
    }

    const res = await this.fetch_(
      `${this.bookingBase}/api/customer/integration/consignment/cancel`,
      {
        method: "POST",
        headers: this.bookingHeaders(),
        body: JSON.stringify(body),
      }
    )

    if (!res.ok) {
      const text = await res.text().catch(() => "")
      throw new Error(`DTDC cancellation failed (${res.status}): ${text}`)
    }

    return this.safeJson(res)
  }

  /**
   * Generate a tracking access token.
   *
   * GET {trackingAuthBase}/dtdc-api/api/dtdc/authenticate?username=<u>&password=<p>
   *
   * The endpoint returns the token as a PLAIN STRING (not JSON), e.g.
   * "GL018_trk_json:bd45addb4aa09ea88364227a4f7b951b".
   */
  async generateTrackingToken(): Promise<string> {
    if (this.trackingAccessToken) {
      return this.trackingAccessToken
    }

    const url = `${this.trackingAuthBase}/dtdc-api/api/dtdc/authenticate?username=${encodeURIComponent(this.trackingUsername)}&password=${encodeURIComponent(this.trackingPassword)}`

    const res = await this.fetch_(url, { method: "GET" })

    if (!res.ok) {
      throw new Error(`DTDC tracking auth failed (${res.status})`)
    }

    const text = (await res.text()).trim()
    if (!text) {
      throw new Error("DTDC tracking auth returned no token")
    }

    // Prefer the raw string (the real response shape); tolerate a JSON wrapper
    // if DTDC ever changes it.
    let token = text
    if (text.startsWith("{") || text.startsWith("[")) {
      try {
        const json = JSON.parse(text)
        token = json?.data?.token || json?.token || json?.access_token || ""
      } catch {
        token = ""
      }
    }
    if (!token) {
      throw new Error("DTDC tracking auth returned no token")
    }

    this.trackingAccessToken = token
    return token
  }

  /**
   * Track a shipment by AWB number (JSON pull).
   *
   * POST {trackingBase}/rest/JSONCnTrk/getTrackDetails
   * Auth: X-Access-Token header
   * Body: { trkType: "cnno", strcnno: "<awb>", addtnlDtl: "Y" }
   */
  async trackShipment(awbNumber: string): Promise<DtdcTrackingResponse> {
    const token = await this.generateTrackingToken()

    const body: DtdcTrackingRequest = {
      trkType: "cnno",
      strcnno: awbNumber,
      addtnlDtl: "Y",
    }

    const res = await this.fetch_(
      `${this.trackingBase}/rest/JSONCnTrk/getTrackDetails`,
      {
        method: "POST",
        headers: {
          "X-Access-Token": token,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      }
    )

    if (!res.ok) {
      throw new Error(`DTDC tracking failed (${res.status})`)
    }

    return this.safeJson(res)
  }
}