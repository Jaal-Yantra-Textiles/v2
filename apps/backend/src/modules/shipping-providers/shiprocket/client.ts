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
import { isInternationalDestination } from "../destination"
import { nonEmptyCode, normalizeHsCode } from "../hs-code-resolution"
import {
  CreateShipmentInput,
  Dimensions,
  LabelResult,
  PickupLocation,
  RateOption,
  RateQuery,
  RegisterPickupLocationInput,
  SchedulePickupInput,
  SchedulePickupResult,
  ShipmentItem,
  ShipmentRef,
  ShipmentResult,
  ShippingProviderClient,
  TrackingEvent,
  TrackingResult,
} from "../provider-interface"
import { MedusaError } from "@medusajs/framework/utils"

const BASE_URL = "https://apiv2.shiprocket.in/v1/external"

/**
 * Minimum HSN length accepted by `/international/*` — live-verified against a
 * 422 that named every line at once. India's ITC-HS export schedule is 8-digit;
 * the 6-digit WCO heading that satisfies the DOMESTIC endpoint is rejected here.
 */
export const INTERNATIONAL_HSN_MIN_DIGITS = 8

/** The subset of `fetch` the client uses — injectable so tests/CI can supply a
 *  deterministic transport instead of patching the global (which doesn't reliably
 *  cross the test ↔ in-process-server boundary). See `stub-fetch.ts`. (#647) */
export type FetchLike = (input: any, init?: any) => Promise<any>

export type ShiprocketOptions = {
  email: string
  password: string
  /** Default registered pickup-location name when a shipment doesn't carry one. */
  pickup_location?: string
  /** Inject a token to skip the login round-trip (e.g. cached). */
  token?: string
  /** Injectable transport (defaults to the global fetch). Used to stub the API. */
  fetchImpl?: FetchLike
}

/**
 * A Shiprocket API failure as a first-class MedusaError, so it flows through
 * the framework's error handler with the right status + a clean `{type,message}`
 * body instead of an opaque 500 (#427). The upstream HTTP status maps onto a
 * MedusaError type; the parsed per-field messages ride along on `fieldErrors`
 * (and the readable summary is already in `message`).
 */
export class ShiprocketApiError extends MedusaError {
  readonly status: number
  readonly fieldErrors?: Record<string, string[]>
  readonly raw?: unknown

  constructor(
    message: string,
    opts: { status: number; fieldErrors?: Record<string, string[]>; raw?: unknown }
  ) {
    super(ShiprocketApiError.typeForStatus(opts.status), message)
    this.name = "ShiprocketApiError"
    this.status = opts.status
    this.fieldErrors = opts.fieldErrors
    this.raw = opts.raw
  }

  /** Map an upstream Shiprocket HTTP status onto a MedusaError type/HTTP code. */
  static typeForStatus(status: number): string {
    // rejected creds → NOT_ALLOWED (400); other client errors incl. 422
    // validation → INVALID_DATA (400); upstream/unknown → UNEXPECTED_STATE (500).
    if (status === 401 || status === 403) return MedusaError.Types.NOT_ALLOWED
    if (status >= 400 && status < 500) return MedusaError.Types.INVALID_DATA
    return MedusaError.Types.UNEXPECTED_STATE
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

/**
 * Known Shiprocket *international prerequisite* failures, turned into friendly,
 * actionable admin guidance (#1118). Shiprocket rejects an international
 * create/label when the account isn't set up for cross-border shipping — KYC
 * not verified, settlement bank details missing, or the pickup location isn't
 * international-enabled. These come back as opaque `ShiprocketApiError`
 * messages that mean nothing to an admin; this maps the known signatures onto a
 * clear "here's what to fix" step.
 *
 * Keyword-based (Shiprocket's wording drifts and isn't documented as codes), so
 * it's deliberately conservative: returns `null` for anything unrecognised, and
 * the caller rethrows the original error untouched. Pure + unit-tested.
 */
export type IntlPrereqReason =
  | "kyc"
  | "bank_details"
  | "pickup_not_intl"
  | "insufficient_balance"

export type IntlPrereqGate = { reason: IntlPrereqReason; message: string }

export function describeIntlPrereqError(err: {
  message?: string
  fieldErrors?: Record<string, string[]>
}): IntlPrereqGate | null {
  const parts: string[] = []
  if (err?.message) parts.push(err.message)
  if (err?.fieldErrors) {
    for (const msgs of Object.values(err.fieldErrors)) parts.push(...msgs)
  }
  const text = parts.join(" ").toLowerCase()
  if (!text) return null

  // Pickup-not-international-enabled — check first: its wording often also
  // mentions "international", which the bare KYC/bank checks don't key on.
  if (
    text.includes("pickup") &&
    (text.includes("international") ||
      text.includes("not enabled") ||
      text.includes("not allowed") ||
      text.includes("not activated"))
  ) {
    return {
      reason: "pickup_not_intl",
      message:
        "This pickup location isn't enabled for international shipping in Shiprocket. Enable international shipping for the pickup address in your Shiprocket dashboard (Settings → Pickup Addresses), or choose an international-capable pickup, then retry generating the label.",
    }
  }

  // Wallet balance. Live-verified 2026-08-06: this arrives as
  // `awb_assign_error: "Insufficient amount to label this shipment"` on an HTTP
  // 200 (see assertAwbAssigned) — the address was fine, the account just can't
  // pay for the waybill. Worth naming because it's indistinguishable from a data
  // problem otherwise.
  if (
    (text.includes("insufficient") || text.includes("low balance")) &&
    (text.includes("amount") ||
      text.includes("balance") ||
      text.includes("wallet") ||
      text.includes("label"))
  ) {
    return {
      reason: "insufficient_balance",
      message:
        "Your Shiprocket wallet doesn't have enough balance to book this waybill. Top up the wallet in your Shiprocket dashboard (Billing → Recharge), then retry generating the label. The shipment details were accepted — only payment is missing.",
    }
  }

  if (text.includes("kyc")) {
    return {
      reason: "kyc",
      message:
        "International shipping requires your Shiprocket KYC to be verified. Complete KYC in your Shiprocket dashboard (Settings → KYC), then retry generating the label.",
    }
  }

  if (
    text.includes("bank") &&
    (text.includes("detail") ||
      text.includes("account") ||
      text.includes("settlement"))
  ) {
    return {
      reason: "bank_details",
      message:
        "International shipping requires your settlement bank details on file with Shiprocket. Add them in your Shiprocket dashboard (Settings → Company → Bank Details), then retry generating the label.",
    }
  }

  return null
}

/**
 * Normalize a Shiprocket `data.shipping_address[]` row into our PickupLocation.
 *
 * Shiprocket exposes `phone_verified` (0/1) — its OTP signal — but per the
 * carrier's behavior an **API-registered pickup is usable for live pickups as
 * soon as it has a complete address**; the phone-OTP step is a separate,
 * dashboard-only action that isn't required to ship (#435, confirmed against a
 * live `/settings/company/pickup` response). So we derive `shippable` from a
 * complete address OR an explicit `phone_verified`, gated by the carrier
 * `status` (an explicit 0 = deactivated overrides). Callers lead with
 * `shippable`; `phone_verified` stays available as a secondary, informational
 * signal so we never show a usable pickup as "not verified" / "unknown".
 */
export function normalizePickupLocation(r: any): PickupLocation {
  const phoneVerified =
    r?.phone_verified !== undefined && r?.phone_verified !== null
      ? Boolean(Number(r.phone_verified))
      : undefined
  const addressComplete = Boolean(
    r?.address && r?.city && r?.pin_code && r?.phone
  )
  // We only have positive samples (status=1); stay conservative — treat an
  // explicit 0 as deactivated and everything else (incl. absent) as active, so
  // this never flips an otherwise-shippable pickup off on an unknown code.
  const active =
    r?.status === undefined || r?.status === null || Number(r.status) !== 0
  const shippable = active && (phoneVerified === true || addressComplete)
  return {
    name: r?.pickup_location || r?.name || "",
    id: r?.id,
    phone_verified: phoneVerified,
    address_complete: addressComplete,
    shippable,
    city: r?.city,
    state: r?.state,
    pincode: r?.pin_code,
    raw: r,
  }
}

/** A Shiprocket adhoc-order `order_items[]` row. */
export type ShiprocketOrderItem = {
  name: string
  sku: string
  units: number
  selling_price: number
  hsn: string
  tax: number | string
}

/**
 * Build Shiprocket `order_items[]` from shipment items, aggregating rows that
 * share an effective SKU.
 *
 * Shiprocket's `/orders/create/adhoc` rejects a payload with a repeated SKU
 * ("SKU cannot be repeated"). Our lines can collide on SKU legitimately —
 * e.g. #817 colour variants of one material, or blank-SKU lines that fall back
 * to the same product name. We merge same-SKU rows (summing `units`) so each
 * SKU appears once; per-item declared value stays consistent because the order
 * `sub_total` is sent separately from the line prices. Blank SKUs fall back to
 * the item name (mirroring the single-item mapping). Order is preserved.
 *
 * Pure & exported for unit testing.
 */
export function buildShiprocketOrderItems(
  items: ShipmentItem[]
): ShiprocketOrderItem[] {
  const bySku = new Map<string, ShiprocketOrderItem>()
  for (const i of items) {
    const sku = (i.sku && String(i.sku).trim()) || i.name
    const units = Number(i.quantity) || 0
    const existing = bySku.get(sku)
    if (existing) {
      existing.units += units
    } else {
      bySku.set(sku, {
        name: i.name,
        sku,
        units,
        selling_price: i.unit_price,
        // Digits only — Shiprocket rejects `6205.20.00` / `6205 20 00` with
        // "HSN should be numeric". An unrecoverable code normalizes to "" and is
        // then caught by the missing-HSN guard rather than posted invalid.
        hsn: normalizeHsCode(i.hsn) || "",
        tax: i.tax ?? "",
      })
    }
  }
  return Array.from(bySku.values())
}

/**
 * Coerce a carrier-quoted charge into a finite number, or undefined.
 *
 * Shiprocket returns freight charges inconsistently — number, numeric string,
 * `"0"`, `""`, or absent depending on courier and endpoint. A blank or
 * unparseable value must NOT become `0`: zero is a real (free-shipping) rate,
 * and recording a fake zero would silently under-deduct a partner's payout.
 */
export function toRate(v: unknown): number | undefined {
  if (v === null || v === undefined || v === "") {
    return undefined
  }
  const n = Number(v)
  return Number.isFinite(n) ? n : undefined
}

/**
 * International shipping (#1111). Shiprocket exposes a SEPARATE
 * `/v1/external/international/*` namespace (create/serviceability/assign/track);
 * a shipment is international when its destination is outside India. See
 * apps/docs/notes/SHIPROCKET_INTERNATIONAL_API.md for the full contract.
 */

/** Destination ISD dial codes for the countries we ship to (best-effort; omitted when unknown). */
const ISD_BY_ISO2: Record<string, string> = {
  US: "+1", CA: "+1", GB: "+44", AU: "+61", NZ: "+64", AE: "+971", SA: "+966",
  SG: "+65", MY: "+60", DE: "+49", FR: "+33", IT: "+39", ES: "+34", NL: "+31",
  IE: "+353", SE: "+46", CH: "+41", JP: "+81", HK: "+852", ZA: "+27",
}

/**
 * Full country NAME for Shiprocket's create body. The international create/adhoc
 * expects a name ("United States"), NOT the ISO code (the serviceability call is
 * the one that wants ISO-2). Our order addresses store ISO-2 `country_code`, so
 * map it via `Intl.DisplayNames` with a couple of overrides where Shiprocket's
 * expected spelling differs. Pure & exported for unit testing.
 */
const COUNTRY_NAME_OVERRIDES: Record<string, string> = {
  US: "United States",
  GB: "United Kingdom",
  AE: "United Arab Emirates",
  KR: "South Korea",
}
export function toShiprocketCountryName(country?: string): string {
  const raw = (country || "").trim()
  if (!raw) return "India"
  if (/^(in|india)$/i.test(raw)) return "India"
  // Already a full name (not a 2-letter code) — pass through.
  if (raw.length > 2) return raw
  const code = raw.toUpperCase()
  if (COUNTRY_NAME_OVERRIDES[code]) return COUNTRY_NAME_OVERRIDES[code]
  try {
    return new Intl.DisplayNames(["en"], { type: "region" }).of(code) || raw
  } catch {
    return raw
  }
}

// Destination classification is carrier-neutral — it now lives in
// `../destination` so an adapter with no export product (Delhivery) can refuse
// the job without importing the Shiprocket client. Re-exported here so the
// existing import sites keep working.
// (A re-export alone wouldn't put the name in this module's scope, and it is
// used below to branch the create flow — so import, then re-export.)
export { isInternationalDestination }

/** Shiprocket international customs fields, with retail-sale defaults applied. */
export type ResolvedCustoms = {
  reasonOfExport: number
  purpose_of_shipment: number
  Terms_Of_Invoice: string
  igstPaymentStatus: string
  commodity: boolean
}
export function resolveCustomsDefaults(
  customs?: import("../provider-interface").CustomsDeclaration
): ResolvedCustoms {
  return {
    // A retail order is a commercial sale, shipped FOB.
    reasonOfExport: customs?.reason_of_export ?? 3, // COMMERCIAL
    purpose_of_shipment: customs?.purpose_of_shipment ?? 2, // commercial
    Terms_Of_Invoice: customs?.terms_of_invoice ?? "FOB",
    // IGST: was "A" (not applicable). Live-verified 2026-08-06 that a complete
    // commercial export body classifies as CSB-5, and CSB-5 REJECTS "A" at
    // create time: "IGST can not be Not Applicable in case of CSB5 shipments."
    // An export of goods is zero-rated either way — this field only says HOW the
    // Indian exporter discharges that: "B" = LUT/bond on file (no IGST paid),
    // "C" = IGST paid and reclaimed.
    //
    // Default "C": as of 2026-08-06 the LUT is applied for but has NO ARN yet,
    // and declaring "B" without an LUT on file is a false declaration. Flip to
    // "B" once the ARN is issued — via SHIPROCKET_IGST_PAYMENT_STATUS (no code
    // change), or per-shipment through the customs declaration.
    igstPaymentStatus:
      customs?.igst_payment_status ??
      (process.env.SHIPROCKET_IGST_PAYMENT_STATUS as "A" | "B" | "C") ??
      "C",
    commodity: customs?.commodity ?? true,
  }
}

/**
 * Build the Shiprocket INTERNATIONAL `create/adhoc` body from a shipment input.
 * Pure & exported so the exact customs payload (country name, currency, HSN,
 * export reason) is unit-testable without a live API. Throws if HSN is missing
 * or shorter than 8 digits on any line (Shiprocket makes a full-length HSN
 * mandatory for every international shipment) or if the caller asked for COD
 * (unavailable internationally).
 */
export function buildInternationalCreateBody(
  input: CreateShipmentInput,
  pickup: string
): Record<string, any> {
  if (input.payment_mode === "cod") {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Shiprocket does not support COD for international shipments"
    )
  }
  const items = buildShiprocketOrderItems(input.items)
  const missingHsn = items.filter((i) => !i.hsn).map((i) => i.name)
  if (missingHsn.length) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `HSN code is required for international shipments; missing on: ${missingHsn.join(", ")}`
    )
  }
  // A code can be PRESENT and still rejected: `/international/*` requires at
  // least 8 digits ("The order_items.0.hsn must be at least 8 characters"),
  // while the domestic endpoint documents 1–15 — which is what `normalizeHsCode`
  // enforces. So the common 6-digit WCO code (620520, 420222 …) passes every
  // check we have and dies at the carrier, one 422 listing every line at once.
  //
  // Deliberately NOT auto-padded to 8. The first 6 digits are the internationally
  // harmonised heading; the last 2 are a NATIONAL subheading, and India's ITC-HS
  // does not simply zero-extend — 4202.22 splits into 42022210/20/30/40/90 with
  // no 42022200 at all. Padding would invent a tariff line that doesn't exist and
  // put it on a customs declaration; the same reason a non-numeric code is
  // treated as missing rather than coerced. Only a human can pick the right
  // subheading, so name the lines and their current codes and stop here.
  const shortHsn = items.filter((i) => i.hsn.length < INTERNATIONAL_HSN_MIN_DIGITS)
  if (shortHsn.length) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `Shiprocket requires an ${INTERNATIONAL_HSN_MIN_DIGITS}-digit HSN code for international shipments, but these lines carry a shorter one: ` +
        `${shortHsn.map((i) => `${i.name} (${i.hsn})`).join(", ")}. ` +
        `Set the full ${INTERNATIONAL_HSN_MIN_DIGITS}-digit ITC-HS code on the product, variant or inventory item — do not pad with zeros, as the last two digits are an Indian national subheading.`
    )
  }
  // Pre-flight the delivery fields Shiprocket rejects downstream. Without this
  // an empty phone or pincode only surfaces at assign/awb as
  // `["Delivery pincode is empty","Customer phone is empty"]` — a 400 two calls
  // deep, after an order has already been created carrier-side. Name them all at
  // once so one round of data-fixing clears them (rather than one per attempt).
  const missingTo = (
    [
      ["phone", input.to.phone],
      ["pincode", input.to.pincode],
      ["address", input.to.address_1],
      ["city", input.to.city],
    ] as const
  )
    .filter(([, v]) => !String(v ?? "").trim())
    .map(([k]) => k)
  if (missingTo.length) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `Shipping address is missing ${missingTo.join(", ")} — Shiprocket rejects an international shipment without ${missingTo.length > 1 ? "these" : "this"}. Add ${missingTo.length > 1 ? "them" : "it"} to the order's shipping address (or billing address / customer record) and retry.`
    )
  }
  const [firstName, ...rest] = (input.to.name || "Customer").split(" ")
  const lastName = rest.join(" ")
  const subTotal =
    input.sub_total ??
    input.items.reduce((s, i) => s + i.unit_price * i.quantity, 0)
  const iso2 = (input.to.country || "").trim().toUpperCase()
  const customs = resolveCustomsDefaults(input.customs)

  const state = nonEmptyCode(input.to.state) || input.to.city
  const countryName = toShiprocketCountryName(input.to.country)

  return {
    order_id: input.reference_id,
    order_date: new Date().toISOString().slice(0, 16).replace("T", " "),
    pickup_location: pickup,
    // The customer is abroad — billing + shipping are the same foreign address.
    billing_customer_name: firstName,
    billing_last_name: lastName,
    billing_address: input.to.address_1,
    billing_address_2: input.to.address_2 || "",
    billing_city: input.to.city,
    billing_pincode: input.to.pincode,
    // Shiprocket makes billing_state mandatory even for destinations that have
    // no province in their address (city-states, or foreign addresses where the
    // buyer left it blank) — it 422s with "The billing state field is required".
    // Fall back to the city, which is what Shiprocket's own support advises for
    // stateless addresses, so a valid order isn't blocked on an empty field.
    billing_state: state,
    billing_country: countryName,
    billing_email: input.to.email || "",
    billing_phone: input.to.phone,
    ...(ISD_BY_ISO2[iso2] ? { isd_code: ISD_BY_ISO2[iso2] } : {}),
    // The DELIVERY block must be sent explicitly. `shipping_is_billing: true` is
    // NOT honored by the international pipeline: create/adhoc returns 200 and
    // `/orders/show` even echoes the copied address back, but
    // `/international/courier/assign/awb` then 400s with
    // `["Delivery pincode is empty","Customer phone is empty"]` — the intl
    // shipment record never got a delivery address. Live-verified 2026-08-06:
    // billing-only + the flag → assign 400; the same order with an explicit
    // shipping_* block → assign 200. Domestic is unaffected (it honors the flag).
    shipping_is_billing: false,
    shipping_customer_name: firstName,
    shipping_last_name: lastName,
    shipping_address: input.to.address_1,
    shipping_address_2: input.to.address_2 || "",
    shipping_city: input.to.city,
    shipping_pincode: input.to.pincode,
    shipping_state: state,
    shipping_country: countryName,
    shipping_email: input.to.email || "",
    shipping_phone: input.to.phone,
    order_items: items,
    payment_method: "Prepaid",
    sub_total: subTotal,
    length: input.dimensions_cm?.length || 10,
    breadth: input.dimensions_cm?.width || 10,
    height: input.dimensions_cm?.height || 10,
    weight: Math.max(0.01, input.weight_grams / 1000),
    // Customs / commercial-invoice fields (amounts are in `currency`, not INR).
    currency: (input.currency || "INR").toUpperCase(),
    reasonOfExport: customs.reasonOfExport,
    purpose_of_shipment: customs.purpose_of_shipment,
    Terms_Of_Invoice: customs.Terms_Of_Invoice,
    igstPaymentStatus: customs.igstPaymentStatus,
    commodity: customs.commodity,
  }
}

/**
 * Normalize one courier from `/international/courier/serviceability` into a
 * `RateOption`. Pure & exported because the international response shape differs
 * from the domestic one in two ways that both silently produced garbage
 * (live-verified 2026-08-06):
 *
 *  · `rate` is an OBJECT (`{ rate: 1125, zone, extra_info: { edd } }`), not a
 *    number. `Number(c.rate)` is NaN, so every international quote came out as
 *    amount 0 — an empty-looking courier picker and a `courier_rate: 0` stamped
 *    on the shipment by the auto-select path.
 *  · `estimated_delivery_days` is a STRING RANGE ("10 - 12"), not a number, so
 *    `Number(...)` was NaN. The structured `rate.extra_info.edd.{from,to}` is
 *    the reliable source; the string is the fallback.
 *
 * The international payload carries no `currency` field, and these accounts are
 * billed in INR, so INR is the fallback — but an explicit currency still wins if
 * Shiprocket ever starts sending one.
 */
export function normalizeInternationalRate(
  c: any,
  recommendedId?: number | string
): RateOption {
  const rateObj = c?.rate && typeof c.rate === "object" ? c.rate : undefined
  const amount = Number(rateObj ? rateObj.rate : c?.rate) || 0
  // Prefer the structured upper bound (the promise we'd show a customer), then
  // the high end of the "10 - 12" string, then a bare number.
  const eddTo = Number(rateObj?.extra_info?.edd?.to)
  // `Number("")` is 0, not NaN — so an absent ETA has to be rejected on the
  // string being empty, or it reports as a 0-day delivery promise.
  const eddText = String(c?.estimated_delivery_days ?? "")
    .split(/[-–]/)
    .pop()
    ?.trim()
  const parsedDays = Number.isFinite(eddTo)
    ? eddTo
    : eddText
      ? Number(eddText)
      : NaN
  return {
    courier_id: c?.courier_company_id,
    courier_name: c?.courier_name,
    amount,
    currency_code: (c?.currency || rateObj?.currency || "inr")
      .toString()
      .toLowerCase(),
    estimated_days: Number.isFinite(parsedDays) ? parsedDays : undefined,
    is_recommended:
      recommendedId != null &&
      String(c?.courier_company_id) === String(recommendedId),
  }
}

/**
 * AWB assignment can FAIL WITH HTTP 200. Shiprocket answers
 * `/courier/assign/awb` (domestic and international) with
 * `{ awb_assign_status: 0, response: { data: { awb_assign_error: "..." } } }`
 * and no `awb_code` — e.g. "Insufficient amount to label this shipment" (wallet
 * balance) or a courier-side rejection. The old code read `awb_code || ""` and
 * returned a shipment carrying a BLANK AWB and no error, so an operator saw a
 * label step that appeared to succeed while nothing was ever booked. Throw
 * instead, with the carrier's own reason. Pure & exported for unit testing.
 */
export function assertAwbAssigned(assigned: any): void {
  const data = assigned?.response?.data || {}
  if (data.awb_code) return
  const reason =
    data.awb_assign_error ||
    assigned?.message ||
    "Shiprocket assigned no AWB and gave no reason"
  throw new ShiprocketApiError(
    `Shiprocket AWB assignment failed — ${reason}`,
    { status: 200, raw: JSON.stringify(assigned) }
  )
}

/** Shiprocket numeric shipment_status_id → coarse scan_type. */
export function scanTypeForStatus(id?: number): string {
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

/**
 * Normalize a Shiprocket webhook push payload into a `TrackingResult` (#888).
 * Pure and exported so the inbound webhook route can parse without carrier
 * credentials (the class method delegates here). Shiprocket pushes carry two
 * parallel status pairs (`current_status`/`shipment_status`) that aren't always
 * in sync — prefer `current_status`, key the coarse scan_type off
 * `shipment_status_id`.
 */
export function normalizeShiprocketWebhook(payload: any): TrackingResult {
  const events: TrackingEvent[] = (payload?.scans || []).map((s: any) => ({
    timestamp: s.date,
    status: s.status || s["sr-status-label"] || "",
    location: s.location || "",
    scan_type: scanTypeForStatus(Number(payload?.shipment_status_id)),
  }))
  return {
    carrier: "shiprocket",
    awb: payload?.awb || "",
    current_status: payload?.current_status || payload?.shipment_status || "",
    current_status_code: payload?.shipment_status_id,
    estimated_delivery: payload?.etd || null,
    events,
    raw: payload,
  }
}

export class ShiprocketClient implements ShippingProviderClient {
  readonly carrier = "shiprocket"

  private email: string
  private password: string
  private defaultPickup?: string
  private token?: string
  private fetchImpl: FetchLike

  constructor(options: ShiprocketOptions) {
    this.email = options.email
    this.password = options.password
    this.defaultPickup = options.pickup_location
    this.token = options.token
    // Default to the global fetch (wrapped so it's never called with a bound
    // `this`, which undici rejects). Tests inject a stub transport instead.
    this.fetchImpl =
      options.fetchImpl ?? ((input, init) => globalThis.fetch(input, init))
  }

  /** Authenticate (or reuse an injected token). Token TTL is ~10 days. */
  private async authenticate(force = false): Promise<string> {
    if (this.token && !force) return this.token
    const res = await this.fetchImpl(`${BASE_URL}/auth/login`, {
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
    const res = await this.fetchImpl(`${BASE_URL}${path}`, {
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
    // An international destination has to go through the `/international/*`
    // serviceability endpoint — the domestic one takes a delivery PINCODE and
    // simply returns no couriers for a foreign postcode, which surfaced as an
    // empty courier picker rather than an error. Branch here (not at the call
    // sites) so every rate caller — admin, partner, inventory-order — gets the
    // right endpoint from the destination country alone.
    if (isInternationalDestination(query.destination_country)) {
      return this.getInternationalRates({
        destination_country: query.destination_country,
        weight_grams: query.weight_grams,
        origin_pincode: query.origin_pincode,
        dimensions_cm: query.dimensions_cm,
      })
    }
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
      // MedusaError (not a raw Error) so callers surface a clean toast, mirroring
      // the credentials/serviceability errors. (#638)
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Shiprocket createShipment requires a pickup_location_name"
      )
    }

    // International destinations use a separate Shiprocket API namespace with a
    // customs-declaration payload (#1111). Domestic (India) stays on the path
    // below unchanged.
    if (isInternationalDestination(input.to.country)) {
      return this.createInternationalShipment(input, pickup)
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
      // Mandatory at Shiprocket even when the address carries no state — fall
      // back to the city (same as the international body above).
      billing_state: nonEmptyCode(input.to.state) || input.to.city,
      billing_country: input.to.country || "India",
      billing_email: input.to.email || "",
      billing_phone: input.to.phone,
      shipping_is_billing: true,
      // Aggregate same-SKU lines — Shiprocket rejects a repeated SKU (#817
      // colour variants / blank-SKU name collisions would otherwise 400 with
      // "SKU cannot be repeated").
      order_items: buildShiprocketOrderItems(input.items),
      payment_method: input.payment_mode === "cod" ? "COD" : "Prepaid",
      sub_total: subTotal,
      length: input.dimensions_cm?.length || 10,
      breadth: input.dimensions_cm?.width || 10,
      height: input.dimensions_cm?.height || 10,
      weight: Math.max(0.01, input.weight_grams / 1000),
    }

    const createAdhoc = async (channelOrderId: string) => {
      const res = await this.request<any>(`/orders/create/adhoc`, {
        method: "POST",
        body: JSON.stringify({ ...createBody, order_id: channelOrderId }),
      })
      if (!res?.shipment_id) {
        throw new Error(
          `Shiprocket order created but returned no shipment_id: ${JSON.stringify(res)}`
        )
      }
      return res
    }
    const assignAwb = async (shipmentIdToAssign: any) => {
      const assignBody: Record<string, any> = {
        shipment_id: [shipmentIdToAssign],
      }
      if (input.preferred_courier_id) {
        assignBody.courier_id = input.preferred_courier_id
      }
      return this.request<any>(`/courier/assign/awb`, {
        method: "POST",
        body: JSON.stringify(assignBody),
      })
    }

    let created = await createAdhoc(String(createBody.order_id))

    // 2) Assign an AWB (force a courier if the caller picked one). Shiprocket
    // dedupes adhoc orders on the channel `order_id`: a reference whose earlier
    // shipment attempt was CANCELLED carrier-side maps back to that cancelled
    // record, and the assign fails with "order is in cancelled state". Retry
    // ONCE under a fresh suffixed channel id so a legitimate re-ship of the
    // same platform order gets a new carrier order instead of a dead end.
    let assigned: any
    try {
      assigned = await assignAwb(created.shipment_id)
    } catch (e: any) {
      const cancelled =
        e instanceof ShiprocketApiError && /cancell?ed state/i.test(e.message)
      if (!cancelled) throw e
      created = await createAdhoc(
        `${input.reference_id}-R${Date.now().toString(36)}`
      )
      assigned = await assignAwb(created.shipment_id)
    }

    const srOrderId = created?.order_id
    const shipmentId = created?.shipment_id
    assertAwbAssigned(assigned)
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
        // What this label actually cost us. The international path has always
        // stamped a rate (from the courier quote it picks); domestic stamped
        // only the courier NAME, so a domestic label left no cost trace at all
        // and the partner's payout couldn't show a shipping deduction.
        // `assign/awb` returns it as `freight_charges` in account currency.
        ...(toRate(awbData.freight_charges) != null
          ? {
              courier_rate: toRate(awbData.freight_charges),
              courier_rate_currency: "INR",
            }
          : {}),
      },
      raw: { created, assigned },
    }
  }

  /**
   * International courier serviceability (#1111). Distinct endpoint from the
   * domestic `getRates` — takes a destination COUNTRY (ISO Alpha-2), not a
   * pincode, and `cod` must be 0 (no international COD). Returns the same
   * normalized RateOption shape.
   */
  async getInternationalRates(query: {
    destination_country?: string
    weight_grams?: number
    order_id?: string | number
    origin_pincode?: string
    dimensions_cm?: Dimensions
  }): Promise<RateOption[]> {
    // Two modes, BOTH live-verified 2026-08-06:
    //  · `order_id` — prices an existing Shiprocket order in its own currency.
    //    Used after create/adhoc to auto-select a courier.
    //  · `delivery_country` + `weight` — quotes BEFORE any order exists, which
    //    is what a pre-label courier picker needs.
    // An earlier note here claimed the country mode "400s on the live account"
    // and that `order_id` was the only one that answers. That was wrong: the
    // country mode 400s ("Please fix request using below fields") only when
    // `pickup_postcode` is omitted. With an origin it returns 200 + couriers.
    // So the origin is REQUIRED in country mode — fail loudly rather than send
    // a request we know comes back 400.
    const qs = new URLSearchParams({ cod: "0" })
    if (query.order_id != null) {
      qs.set("order_id", String(query.order_id))
    } else {
      if (!query.origin_pincode) {
        throw new MedusaError(
          MedusaError.Types.INVALID_DATA,
          "International courier rates need a pickup pincode (origin). Register a Shiprocket pickup location before requesting rates."
        )
      }
      qs.set("weight", String(Math.max(0.01, (query.weight_grams || 500) / 1000)))
      qs.set("delivery_country", (query.destination_country || "").toUpperCase())
      // Dimensions are NOT cosmetic on a cross-border quote — international
      // couriers price on VOLUMETRIC weight, and the size also decides who will
      // carry it. Live-verified (176215→IL, 1.2 kg actual):
      //   no dims        → 5 couriers, charge weight 1.2, SRX Economy Pro ₹3119
      //   30×25×10       → charge weight 1.5, SRX Economy Pro ₹3700
      //   60×50×40       → only 2 couriers left, Aramex ₹8477 → ₹57,937 (24 kg)
      // Quoting without them understates the price and offers couriers that
      // cannot take the parcel.
      if (query.dimensions_cm) {
        qs.set("length", String(query.dimensions_cm.length))
        qs.set("breadth", String(query.dimensions_cm.width))
        qs.set("height", String(query.dimensions_cm.height))
      }
    }
    if (query.origin_pincode) qs.set("pickup_postcode", query.origin_pincode)
    const json = await this.request<any>(
      `/international/courier/serviceability?${qs}`,
      { method: "GET" }
    )
    const couriers = json?.data?.available_courier_companies || []
    const recommended = json?.data?.recommended_courier_company_id
    return couriers.map((c: any) => normalizeInternationalRate(c, recommended))
  }

  /**
   * Create an INTERNATIONAL shipment: create order → resolve an international
   * courier (caller's choice, else the recommended one from serviceability) →
   * assign AWB → generate label. Mirrors the domestic sequence (incl. the
   * cancelled-order suffixed retry) but against `/international/*` endpoints and
   * with a customs-declaration body. (#1111)
   */
  private async createInternationalShipment(
    input: CreateShipmentInput,
    pickup: string
  ): Promise<ShipmentResult> {
    const createBody = buildInternationalCreateBody(input, pickup)

    const createAdhoc = async (channelOrderId: string) => {
      const res = await this.request<any>(
        `/international/orders/create/adhoc`,
        { method: "POST", body: JSON.stringify({ ...createBody, order_id: channelOrderId }) }
      )
      if (!res?.shipment_id) {
        throw new Error(
          `Shiprocket international order created but returned no shipment_id: ${JSON.stringify(res)}`
        )
      }
      return res
    }

    // Pick a courier: caller's explicit choice wins; otherwise ask international
    // serviceability for the recommended one. Live-verified (#1111): intl
    // serviceability only answers in the `order_id` mode, so the lookup must
    // happen AFTER the order is created (the domestic flow auto-selects on
    // assign, but international assign needs an explicit courier). Best-effort —
    // if serviceability fails we still assign and let Shiprocket default. We
    // return the chosen RateOption too so the caller can surface which courier
    // (and rate/currency) was auto-selected — S3 chose auto-select-only, so this
    // read-only visibility replaces a picker.
    const resolveCourier = async (
      srOrderIdForRates: any
    ): Promise<{ id?: string | number; rate?: RateOption }> => {
      let rate: RateOption | undefined
      try {
        const rates = await this.getInternationalRates({
          order_id: srOrderIdForRates,
        })
        rate = input.preferred_courier_id
          ? rates.find(
              (r) => String(r.courier_id) === String(input.preferred_courier_id)
            )
          : rates.find((r) => r.is_recommended) || rates[0]
      } catch {
        // best-effort — assign can still auto-select carrier-side.
      }
      return { id: input.preferred_courier_id ?? rate?.courier_id, rate }
    }

    const assignAwb = async (shipmentIdToAssign: any, courierId?: string | number) => {
      const assignBody: Record<string, any> = { shipment_id: [shipmentIdToAssign] }
      if (courierId) assignBody.courier_id = courierId
      return this.request<any>(`/international/courier/assign/awb`, {
        method: "POST",
        body: JSON.stringify(assignBody),
      })
    }

    let created = await createAdhoc(String(createBody.order_id))
    let courier = await resolveCourier(created.order_id)
    let assigned: any
    try {
      assigned = await assignAwb(created.shipment_id, courier.id)
    } catch (e: any) {
      const cancelled =
        e instanceof ShiprocketApiError && /cancell?ed state/i.test(e.message)
      if (!cancelled) throw e
      created = await createAdhoc(
        `${input.reference_id}-R${Date.now().toString(36)}`
      )
      courier = await resolveCourier(created.order_id)
      assigned = await assignAwb(created.shipment_id, courier.id)
    }

    const srOrderId = created?.order_id
    const shipmentId = created?.shipment_id
    assertAwbAssigned(assigned)
    const awbData = assigned?.response?.data || {}
    const awb = awbData.awb_code || ""

    // Label (shared endpoint; best-effort — may not be ready instantly).
    let labelUrl = ""
    try {
      const label = await this.request<any>(`/courier/generate/label`, {
        method: "POST",
        body: JSON.stringify({ shipment_id: [shipmentId] }),
      })
      labelUrl = label?.label_url || ""
    } catch {
      // Fetch later via getLabel(); don't fail the shipment.
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
        courier_company_id: awbData.courier_company_id ?? courier.rate?.courier_id,
        courier_name: awbData.courier_name ?? courier.rate?.courier_name,
        // The auto-selected international courier's quoted rate (S3 visibility).
        courier_rate: courier.rate?.amount,
        courier_rate_currency: courier.rate?.currency_code,
        international: true,
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
    // Include the chosen pickup date when given — Shiprocket expects
    // `pickup_date` as an array of "YYYY-MM-DD". Omitting it lets Shiprocket
    // pick the earliest slot (previous behaviour).
    const pickupBody: Record<string, any> = { shipment_id: [shipmentId] }
    if (input.pickup_date) {
      pickupBody.pickup_date = [String(input.pickup_date)]
    }
    const json = await this.request<any>(`/courier/generate/pickup`, {
      method: "POST",
      body: JSON.stringify(pickupBody),
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
    // Shiprocket validates the `address` (line 1) alone must contain a
    // road/house token ("address must have Road or House no") and does NOT
    // consult `address_2` for that check. Our stored addresses often strand the
    // road/landmark in line 2 (or keep a Plus Code in line 1), which failed
    // registration even though the real street was present. The dashboard
    // flattens everything into line 1, so mirror it: compose both lines into
    // `address` and leave `address_2` empty.
    const composedAddress =
      [input.address_1, input.address_2]
        .map((s) => (s || "").trim())
        .filter(Boolean)
        .join(", ") || input.address_1
    const json = await this.request<any>(`/settings/company/addpickup`, {
      method: "POST",
      body: JSON.stringify({
        pickup_location: input.name,
        name: input.name,
        // Shiprocket rejects an empty email (422). Fall back to the account
        // email so registration always has a valid contact (#427).
        email: input.email || this.email,
        phone: input.phone,
        address: composedAddress,
        address_2: "",
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
   * idempotent registration and to surface whether a pickup is shippable — see
   * `normalizePickupLocation` for how that's derived.
   */
  async listPickupLocations(): Promise<PickupLocation[]> {
    const json = await this.request<any>(`/settings/company/pickup`, {
      method: "GET",
    })
    const rows = json?.data?.shipping_address || []
    return rows.map((r: any) => normalizePickupLocation(r))
  }

  /** Normalize the Shiprocket webhook push payload (P2). */
  normalizeWebhook(payload: any): TrackingResult {
    return normalizeShiprocketWebhook(payload)
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
