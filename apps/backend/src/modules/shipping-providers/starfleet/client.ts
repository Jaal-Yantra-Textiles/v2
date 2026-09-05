/**
 * Delhivery International ("StarFleet") cross-border API client.
 *
 * StarFleet is Delhivery's international arm — India → rest-of-world. Unlike
 * the domestic Delhivery client (static `Token` auth, single `create.json`
 * call), StarFleet is OAuth2 password-grant behind an async batch job:
 *
 *   POST /auth/token                       → `access_token` (Bearer, 24h TTL)
 *   POST /package/batchGeneratePackages    → returns a JOB id, not an AWB
 *   GET  /package/batchGeneratePackages/{id} → poll until COMPLETED →
 *                                               `success_waybills[]` (waybill)
 *   GET  /package/auth-track/{id}          → scans for 1..15 waybills
 *   GET  /package/{id}/shipping-label      → PDF  (⚠️ gated — see below)
 *   GET  /package/{id}/invoice             → PDF  (⚠️ gated — see below)
 *
 * Live-verified against api-stage-starfleet (a real AWB `DL001113245XB` was
 * manifested end-to-end). The full contract is in
 * apps/docs/notes/STARFLEET_API.md — read it before touching this file. The
 * load-bearing gotchas:
 *
 *  1. SCOPE MUST BE QUOTED. The /auth/token `scope` parameter is the literal
 *     `scope="starfleet openid profile email ^/package/... $"` — WITH the
 *     double-quotes. A bare `scope=...` (no quotes) mints a token that 401s on
 *     every /package endpoint. The `\/` escaping the swagger shows is
 *     irrelevant; the quotes are not.
 *  2. `client_name` MUST be the account username (e.g. `8e2306-JaalYantraTextilesPr-in`),
 *     NOT a guessed name — anything else is `403 Unauthorized User`.
 *  3. pickup is `pickup_warehouse_id + zip + state + city`, and the warehouse
 *     must EXIST in the target environment (prod warehouses aren't in staging).
 *  4. The manifest is ASYNC: create → poll → success_waybills[].waybill.
 *  5. Products need `igst_rate`/`igst_amount` (0 for sample) + `euec`/`meis`;
 *     omitting them fails manifestation with `Value is empty`.
 *
 * ⚠️ NOT YET WORKING (Delhivery-side gates, not this client):
 *  - invoice + shipping-label return `403 Unauthorized User` even with a valid
 *    token (per-user id_token, or shipment not label-ready). Methods exist but
 *    surface the carrier's 403 until Delhivery resolves it.
 *  - upload-kyc-doc is DEPRECATED by Delhivery and not in use. It is not
 *    called, and its path has been dropped from the requested OAuth scope.
 *  - No cancellation endpoint exists in the StarFleet surface — `cancelShipment`
 *    throws.
 */
import { MedusaError } from "@medusajs/framework/utils"
import {
  CreateShipmentInput,
  LabelResult,
  ShipmentRef,
  ShipmentResult,
  ShippingProviderClient,
  TrackingEvent,
  TrackingResult,
} from "../provider-interface"
import { isInternationalDestination } from "../destination"
import { normalizeHsCode } from "../hs-code-resolution"

/**
 * 🔴 StarFleet has two hosts and the warehouse registry is PER-ENVIRONMENT — a
 * prod warehouse does not exist in staging and vice versa (gotcha #3). Pinning
 * the host to staging, as this file first did, means prod credentials
 * authenticate against the sandbox: `pickup_warehouse_id` then resolves to a
 * warehouse that is not there, and the failure surfaces as a manifestation
 * error rather than as "you are pointed at the wrong environment".
 *
 * Defaults to STAGING, so nothing changes for anyone until the var is set —
 * enabling prod is a deliberate act, not a side effect of deploying.
 */
const STARFLEET_HOSTS = {
  staging: "https://api-stage-starfleet.delhivery.com",
  prod: "https://api-starfleet.delhivery.com",
} as const

export const starfleetBaseUrl = (env?: string): string =>
  String(env ?? "").trim().toLowerCase() === "prod"
    ? STARFLEET_HOSTS.prod
    : STARFLEET_HOSTS.staging

const HOST = starfleetBaseUrl(process.env.STARFLEET_ENV)
const AUTH_URL = `${HOST}/auth/token`
const PACKAGE_BASE_URL = `${HOST}/package`
const AUTH_AUDIENCE = "StarFleet"
/**
 * The scope is wrapped in literal double-quotes on purpose — see gotcha #1.
 * Do NOT remove the quotes; a bare scope mints a token that 401s everywhere.
 *
 * ⚠️ `^/package/.+/upload-kyc-doc:POST` was here and has been REMOVED: Delhivery
 * confirmed the KYC upload API is DEPRECATED and not in use. It was also the one
 * entry with no trailing `$`, and the 502 it returned was read here as "their
 * server is having a bad day" — it was a retired endpoint answering the only way
 * it could. Requesting scope for a path the authorisation server may stop
 * recognising puts the whole token mint at risk, and the token is what every
 * other call depends on.
 *
 * 🔴 This exact string has NOT been re-verified against a live /auth/token since
 * the removal. The scope is minted as a unit and a bad one fails by returning a
 * token that 401s on every endpoint — not by refusing — so confirm one manifest
 * against staging before relying on it in prod.
 */
const AUTH_SCOPE =
  'starfleet openid profile email ^/package/batchGeneratePackages:POST$ ' +
  '^/package/batchGeneratePackages/.+:GET$ ^/package/auth-track/.+:GET$ ' +
  '^/package/.+/invoice:GET$ ^/package/.+/shipping-label:GET$'

/** The scope as sent, exposed so the shape can be asserted (see the spec). */
export const starfleetAuthScope = (): string => AUTH_SCOPE
/** Refresh a little under the documented 86400s (24h) so a token never expires
 *  mid-request. */
const TOKEN_TTL_MS = 23 * 60 * 60 * 1000

const JOB_POLL_INTERVAL_MS = 1000
const JOB_POLL_MAX_ATTEMPTS = 30

/** The subset of `fetch` the client uses — injectable so tests/CI can supply a
 *  deterministic transport (same pattern as Shiprocket/ShipGlobal, #647). */
export type FetchLike = (input: any, init?: any) => Promise<any>

/** The seller's export KYC, mandatory for `commercial` shipments (PAN, GST,
 *  bank + IFSC, AD code, IEC). Account-level, so it comes from config, not the
 *  order. Sample/gift/document shipments don't need it. */
export type StarfleetConsignorKyc = {
  document_id?: string
  document_type?: "Aadhar" | "Passport" | "Voter ID" | "PAN" | "GST"
  iec?: string
  pan?: string
  gstin?: string
  bank_ad_code?: string
  bank_ifsc?: string
  bank_ac?: string
}

export type StarfleetOptions = {
  username: string
  password: string
  client_id: string
  client_secret: string
  /**
   * Delhivery international account name stamped on every package's
   * `client_name`. Defaults to `username` (they are the same value for these
   * accounts). MUST match the authenticated account — see gotcha #2.
   */
  client_name?: string
  /** `service_type` for exports — EXPORTS_EXPRESS (default), EXPORTS_DOCUMENT,
   *  EXPORTS_DEFERRED_EXPRESS, EXPORTS_DLV_SAVER. */
  service_type?: string
  /** Billing mode: "E" express / "S" surface. Default "E". */
  billing_mode?: "E" | "S"
  /**
   * StarFleet-registered pickup warehouse id (env-specific — a prod warehouse
   * does not exist in staging). When set, pickup is the RegisteredAddress shape
   * (`pickup_warehouse_id + zip + state + city`); when absent, pickup is the
   * UnregisteredAddress shape built from the order's `from` address.
   */
  pickup_warehouse_id?: string
  /** Account-level seller export KYC (commercial shipments). */
  consignor_kyc?: StarfleetConsignorKyc
  /** Injectable transport (defaults to the global fetch). */
  fetchImpl?: FetchLike
}

export type StarfleetToken = {
  access_token: string
  id_token?: string
  expires_in?: number
}

/** A StarFleet API failure as a first-class MedusaError, mirroring
 *  `ShipglobalApiError`. Maps the upstream HTTP status onto a MedusaError type. */
export class StarfleetApiError extends MedusaError {
  readonly status: number
  readonly raw?: unknown

  constructor(message: string, opts: { status: number; raw?: unknown }) {
    super(StarfleetApiError.typeForStatus(opts.status), message)
    this.name = "StarfleetApiError"
    this.status = opts.status
    this.raw = opts.raw
  }

  static typeForStatus(status: number): string {
    if (status === 401 || status === 403) return MedusaError.Types.NOT_ALLOWED
    if (status >= 400 && status < 500) return MedusaError.Types.INVALID_DATA
    return MedusaError.Types.UNEXPECTED_STATE
  }
}

/** Map `CustomsDeclaration.reason_of_export` → StarFleet `shipment_type`. */
export function shipmentTypeForReason(reason: number | undefined): string {
  // 0 BONAFIDE_SAMPLE · 1 SAMPLE · 2 GIFT · 3 COMMERCIAL (see provider-interface)
  if (reason === 2) return "gift"
  if (reason === 0 || reason === 1) return "sample"
  return "commercial"
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

/**
 * Build one StarFleet `PackageMetadata` from a normalized shipment input.
 * Pure & exported so the exact payload (invoice terms, IGST status, product
 * line maths, pickup shape) is unit-testable without a live API.
 *
 * The StarFleet manifest forbids `& \ % # ;` in address/name fields (see the
 * swagger info block) — the caller is responsible for having sanitised them
 * upstream (domestic Delhivery does the same).
 */
export function buildPackagePayload(
  input: CreateShipmentInput,
  opts: {
    client_name: string
    service_type: string
    billing_mode: "E" | "S"
    pickup_warehouse_id?: string
    consignor_kyc?: StarfleetConsignorKyc
  }
): Record<string, any> {
  const to = input.to
  const from = input.from ?? ({} as CreateShipmentInput["from"])
  const countryCode = String(to.country || "").trim().toUpperCase()
  const kyc = opts.consignor_kyc ?? {}

  const products = (input.items || []).map((i) => {
    const qty = i.quantity || 1
    const unitPrice = i.unit_price || 0
    const productAmount = round2(unitPrice * qty)
    const igstRate = i.tax != null ? Number(i.tax) : 0
    const igstAmount = round2((productAmount * igstRate) / 100)
    return {
      desc: i.name || "Item",
      quantity: qty,
      unit_price: unitPrice,
      // `product_amount` = unit price × quantity; `item_commodity_value` is the
      // customs declared value of the line (equal to product amount pre-tax).
      product_amount: productAmount,
      item_commodity_value: productAmount,
      // `total_amount` = item total including tax.
      total_amount: round2(productAmount + igstAmount),
      hsn_code: normalizeHsCode(i.hsn) || "",
      igst_rate: igstRate,
      igst_amount: igstAmount,
      euec: false,
      meis: false,
    }
  })

  const totalCommodityValue = round2(
    products.reduce((sum, p) => sum + (p.item_commodity_value || 0), 0)
  )
  const packageAmount = round2(
    input.sub_total != null
      ? input.sub_total
      : products.reduce((sum, p) => sum + (p.total_amount || 0), 0)
  )

  const customs = input.customs ?? {}
  const shipmentType = shipmentTypeForReason(customs.reason_of_export)
  const isCommercial = shipmentType === "commercial"
  // IGST status: "C" = against IGST payment → "Paid"; "B" = LUT/bond → "LUT".
  const igstStatus =
    customs.igst_payment_status === "B"
      ? "LUT"
      : customs.igst_payment_status === "C"
        ? "Paid"
        : isCommercial
          ? "Paid"
          : undefined

  const invoice: Record<string, any> = {
    number: input.reference_id,
    date: new Date().toISOString().slice(0, 10),
    terms: customs.terms_of_invoice ?? "FOB",
  }
  if (isCommercial && igstStatus) {
    invoice.igst_payment_status = igstStatus
  }

  const deliveryLocation: Record<string, any> = {
    address: [to.address_1, to.address_2].filter(Boolean).join(", "),
    city: to.city || "",
    state: to.state || "",
    country: countryCode,
    zip: to.pincode || "",
  }

  // The pickup: registered warehouse (id + address) when configured, else the
  // order's own origin as an unregistered address (no `name` — that key flips
  // StarFleet into a failed warehouse lookup).
  const pickupLocation: Record<string, any> = opts.pickup_warehouse_id
    ? {
        pickup_warehouse_id: opts.pickup_warehouse_id,
        country: "IN",
        zip: from?.pincode || "",
        state: from?.state || "",
        city: from?.city || "",
      }
    : {
        type: "Office",
        address: [from?.address_1, from?.address_2].filter(Boolean).join(", "),
        city: from?.city || "",
        state: from?.state || "",
        country: "IN",
        zip: from?.pincode || "",
      }

  const consignor: Record<string, any> = {
    name: from?.name || "",
    phone: from?.phone || "",
    email: from?.email || "",
    type: "Office",
    address: [from?.address_1, from?.address_2].filter(Boolean).join(", "),
    city: from?.city || "",
    state: from?.state || "",
    country: String(from?.country || "IN").toUpperCase(),
    zip: from?.pincode || "",
    gstin: input.tax_id || kyc.gstin || "",
    ...(kyc.document_id ? { document_id: kyc.document_id } : {}),
    ...(kyc.document_type ? { document_type: kyc.document_type } : {}),
    ...(kyc.iec ? { iec: kyc.iec } : {}),
    ...(kyc.pan ? { pan: kyc.pan } : {}),
    ...(kyc.bank_ad_code ? { bank_ad_code: kyc.bank_ad_code } : {}),
    ...(kyc.bank_ifsc ? { bank_ifsc: kyc.bank_ifsc } : {}),
    ...(kyc.bank_ac ? { bank_ac: kyc.bank_ac } : {}),
  }

  return {
    weight: input.weight_grams || 0,
    dims: {
      length: input.dimensions_cm?.length ?? 10,
      width: input.dimensions_cm?.width ?? 10,
      height: input.dimensions_cm?.height ?? 10,
    },
    package_amount: packageAmount,
    total_commodity_value: totalCommodityValue,
    shipment_type: shipmentType,
    currency: (input.currency || "INR").toUpperCase(),
    order_no: input.reference_id,
    client_name: opts.client_name,
    transaction_type: "B2C",
    payment_mode: input.payment_mode === "cod" ? "COD" : "Prepaid",
    cod_amount: input.payment_mode === "cod" ? input.cod_amount || 0 : 0,
    service_type: opts.service_type,
    billing_mode: opts.billing_mode,
    battery: false,
    invoice,
    return_location: {
      address: [from?.address_1, from?.address_2].filter(Boolean).join(", "),
      zip: from?.pincode || "",
    },
    pickup_location: pickupLocation,
    delivery_location: deliveryLocation,
    bill_to: { as_shipto: true },
    clearance_mode: "courier",
    products,
    add_on_services: {
      // free_domicile = "bill duties to shipper" = a DDP sale (we clear + pay).
      free_domicile: customs.incoterm === "DDP",
      signature_pod: false,
    },
    consignor,
    consignee: {
      name: to.name || "",
      email: to.email || "",
      phone: to.phone || "",
    },
  }
}

/**
 * Extract the waybill Delhivery assigned to a specific `order_id` from a
 * COMPLETED batch-job response. Pure & exported for unit testing.
 */
export function extractWaybillForOrder(
  batchResponse: any,
  orderId: string
): string {
  const payload = batchResponse?.payload ?? {}
  const data = payload.data ?? {}
  const success = data.success_waybills ?? (Array.isArray(data) ? data : [])
  const found = (Array.isArray(success) ? success : []).find(
    (row: any) => String(row?.order_id ?? row?.order_no ?? "") === String(orderId)
  )
  return typeof found?.waybill === "string" && found.waybill
    ? found.waybill
    : ""
}

/** StarFleet scan `action` code → our coarse `scan_type`. The action codes are
 *  opaque (`INT-PKG-MANF` manifestation, …), so classify by the free-text
 *  `remarks`/`action` and default to in_transit. */
export function scanTypeForAction(action?: string, remarks?: string): string {
  const text = `${action ?? ""} ${remarks ?? ""}`.toLowerCase()
  if (text.includes("deliver")) return "delivered"
  if (text.includes("rto") || text.includes("return")) return "rto"
  if (text.includes("manifest") || text.includes("manf")) return "created"
  return "in_transit"
}

/**
 * Normalize a StarFleet `/auth-track` response into our `TrackingResult`. Pure
 * & exported so the normalize path can run without carrier credentials.
 */
export function normalizeStarfleetTracking(
  payload: any,
  awb: string
): TrackingResult {
  const founds = payload?.payload?.waybills_found ?? []
  const pkg = (Array.isArray(founds) ? founds : []).find(
    (w: any) => String(w?.waybill ?? "") === String(awb)
  )
  const scans: any[] = Array.isArray(pkg?.scans) ? pkg.scans : []

  const events: TrackingEvent[] = scans.map((s: any) => ({
    timestamp: s?.time ?? "",
    status: s?.remarks ?? s?.action ?? "",
    location: [s?.city, s?.state, s?.country].filter(Boolean).join(", "),
    scan_type: scanTypeForAction(s?.action, s?.remarks),
  }))

  const last = events[events.length - 1]
  return {
    carrier: "starfleet",
    awb,
    current_status: last?.status ?? "",
    current_status_code: undefined,
    estimated_delivery: null,
    origin: pkg?.origin ?? undefined,
    destination: pkg?.destination?.city ?? undefined,
    events,
    raw: payload,
  }
}

/** Tracking URL for a StarFleet AWB (Delhivery's international track page). */
export function starfleetTrackingUrl(awb: string): string {
  return awb
    ? `https://www.delhivery.com/track/package/${encodeURIComponent(awb)}`
    : ""
}

export class StarfleetClient implements ShippingProviderClient {
  readonly carrier = "starfleet"

  private options: StarfleetOptions
  private fetchImpl: FetchLike
  private accessToken: string | null = null
  private tokenExpiry = 0

  constructor(options: StarfleetOptions) {
    this.options = options
    this.fetchImpl =
      options.fetchImpl ?? ((input, init) => globalThis.fetch(input, init))
  }

  private clientName(): string {
    return this.options.client_name || this.options.username
  }

  /** Fetch (and cache) an OAuth2 access token from /auth/token. The scope is
   *  wrapped in literal double-quotes — gotcha #1. */
  async authenticate(): Promise<StarfleetToken> {
    const body = new URLSearchParams({
      grant_type: "password",
      username: this.options.username,
      password: this.options.password,
      audience: AUTH_AUDIENCE,
      scope: `"${AUTH_SCOPE}"`,
      client_id: this.options.client_id,
      client_secret: this.options.client_secret,
    })
    const res = await this.fetchImpl(AUTH_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    })
    const raw = await res.text().catch(() => "")
    let json: any
    try {
      json = raw ? JSON.parse(raw) : {}
    } catch {
      json = undefined
    }
    if (!res.ok || !json?.access_token) {
      throw new StarfleetApiError(
        `StarFleet auth failed (${res.status})${raw ? ` — ${raw}` : ""}`,
        { status: res.status, raw }
      )
    }
    this.accessToken = json.access_token as string
    this.tokenExpiry = Date.now() + (json.expires_in
      ? Number(json.expires_in) * 1000 - 60_000
      : TOKEN_TTL_MS)
    return json as StarfleetToken
  }

  private async bearer(): Promise<string> {
    if (this.accessToken && Date.now() < this.tokenExpiry) {
      return this.accessToken
    }
    const token = await this.authenticate()
    return token.access_token
  }

  /** Authorized GET/POST against the package API, parsing JSON and raising a
   *  StarfleetApiError on a non-2xx. */
  private async request<T = any>(
    method: "GET" | "POST",
    path: string,
    init?: { body?: unknown; headers?: Record<string, string> }
  ): Promise<T> {
    const token = await this.bearer()
    const res = await this.fetchImpl(`${PACKAGE_BASE_URL}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        "Content-Type": "application/json",
        ...(init?.headers ?? {}),
      },
      body: init?.body === undefined ? undefined : JSON.stringify(init.body),
    })
    const raw = await res.text().catch(() => "")
    let json: any
    try {
      json = raw ? JSON.parse(raw) : {}
    } catch {
      json = undefined
    }
    if (!res.ok) {
      throw new StarfleetApiError(
        `StarFleet ${path} failed (${res.status})${raw ? ` — ${raw}` : ""}`,
        { status: res.status, raw }
      )
    }
    return json as T
  }

  /** Poll a batch job id until COMPLETED/FAILED, returning the job response. */
  private async pollJob(jobId: string): Promise<any> {
    for (let attempt = 0; attempt < JOB_POLL_MAX_ATTEMPTS; attempt++) {
      const res = await this.request<any>("GET", `/batchGeneratePackages/${jobId}`)
      const status = res?.payload?.status ?? res?.status
      if (status === "COMPLETED" || status === "FAILED") {
        return res
      }
      await new Promise((r) => setTimeout(r, JOB_POLL_INTERVAL_MS))
    }
    throw new MedusaError(
      MedusaError.Types.UNEXPECTED_STATE,
      `StarFleet batch job ${jobId} did not complete within ${JOB_POLL_MAX_ATTEMPTS * JOB_POLL_INTERVAL_MS}ms`
    )
  }

  async createShipment(input: CreateShipmentInput): Promise<ShipmentResult> {
    if (!isInternationalDestination(input.to.country)) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Delhivery International (StarFleet) is cross-border only and cannot ship a domestic (India) destination"
      )
    }
    const pkg = buildPackagePayload(input, {
      client_name: this.clientName(),
      service_type: this.options.service_type || "EXPORTS_EXPRESS",
      billing_mode: this.options.billing_mode || "E",
      /**
       * 🔴 The SHIPMENT's pickup wins over the account-wide option.
       *
       * `pickup_warehouse_id` is the warehouse NAME, and
       * `input.pickup_location_name` is that same name — the caller has already
       * resolved it via `ensureCarrierPickup`, registering the location with
       * Delhivery on the fly if it was new. Reading only the static option meant
       * every partner's parcel manifested from ONE account-wide warehouse
       * regardless of where it was actually collected.
       */
      pickup_warehouse_id:
        input.pickup_location_name || this.options.pickup_warehouse_id,
      consignor_kyc: this.options.consignor_kyc,
    })

    // StarFleet manifests in BULK — a single order travels as a one-row batch.
    const res = await this.request<any>("POST", "/batchGeneratePackages", {
      body: { packages: [pkg] },
    })
    const jobId = res?.payload?.id
    if (!jobId) {
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        `StarFleet accepted the manifest but returned no job id: ${JSON.stringify(res)}`
      )
    }

    const done = await this.pollJob(jobId)
    const awb = extractWaybillForOrder(done, input.reference_id)
    if (!awb) {
      const errors = done?.payload?.data?.error_waybills ?? []
      const reason = (Array.isArray(errors) ? errors : [])
        .map((e: any) => e?.reason ?? JSON.stringify(e))
        .join("; ")
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        `StarFleet manifest completed without a waybill for order ${input.reference_id}${reason ? ` — ${reason}` : ""}`
      )
    }

    return {
      carrier: this.carrier,
      awb,
      tracking_number: awb,
      tracking_url: starfleetTrackingUrl(awb),
      provider_refs: { waybill: awb, job_id: jobId },
      raw: done,
    }
  }

  /**
   * ⚠️ GATED on the carrier side: shipping-label currently returns
   * `403 Unauthorized User` even with a valid token (per-user id_token, or the
   * shipment not being label-ready). Surfaces that 403 as a StarfleetApiError
   * until Delhivery resolves it.
   */
  async getLabel(ref: ShipmentRef): Promise<LabelResult> {
    const awb = refAwb(ref)
    if (!awb) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "StarFleet getLabel requires an AWB/waybill"
      )
    }
    const token = await this.bearer()
    const res = await this.fetchImpl(
      `${PACKAGE_BASE_URL}/${awb}/shipping-label`,
      { headers: { Authorization: `Bearer ${token}`, Accept: "application/pdf" } }
    )
    if (!res.ok) {
      const raw = await res.text().catch(() => "")
      throw new StarfleetApiError(
        `StarFleet shipping-label failed (${res.status})${raw ? ` — ${raw}` : ""}`,
        { status: res.status, raw }
      )
    }
    const buf = Buffer.from(await res.arrayBuffer())
    return { data: buf.toString("base64"), format: "pdf" }
  }

  /** Fetch the customs invoice PDF for a waybill (same carrier-side 403 gate as
   *  the label). */
  async getInvoice(ref: ShipmentRef): Promise<LabelResult> {
    const awb = refAwb(ref)
    if (!awb) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "StarFleet getInvoice requires an AWB/waybill"
      )
    }
    const token = await this.bearer()
    const res = await this.fetchImpl(`${PACKAGE_BASE_URL}/${awb}/invoice`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/pdf" },
    })
    if (!res.ok) {
      const raw = await res.text().catch(() => "")
      throw new StarfleetApiError(
        `StarFleet invoice failed (${res.status})${raw ? ` — ${raw}` : ""}`,
        { status: res.status, raw }
      )
    }
    const buf = Buffer.from(await res.arrayBuffer())
    return { data: buf.toString("base64"), format: "pdf" }
  }

  async track(ref: ShipmentRef): Promise<TrackingResult> {
    const awb = refAwb(ref)
    if (!awb) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "StarFleet track requires an AWB/waybill"
      )
    }
    const res = await this.request<any>("GET", `/auth-track/${awb}`)
    return normalizeStarfleetTracking(res, awb)
  }

  async cancelShipment(
    _ref: ShipmentRef
  ): Promise<{ success: boolean; raw?: any }> {
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      "Delhivery International (StarFleet) does not expose a cancellation API — cancel through the Delhivery International portal"
    )
  }
}

/** The AWB/waybill number on a persisted shipment ref, from whichever key the
 *  resolver/framework stashed it. */
function refAwb(ref: ShipmentRef): string {
  const v =
    ref?.awb ??
    ref?.provider_refs?.waybill ??
    ref?.provider_refs?.awb ??
    ""
  return String(v || "").trim()
}