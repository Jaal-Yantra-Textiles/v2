/**
 * Adapts the existing DelhiveryClient to the normalized ShippingProviderClient
 * interface (#31) WITHOUT touching the client itself. Delhivery's create call
 * auto-assigns the waybill, so `createShipment` is a single round-trip; the
 * waybill is the only ref needed for label/track/cancel.
 */
import { MedusaError } from "@medusajs/framework/utils"

import { DelhiveryClient, DelhiveryOptions } from "./client"
import { isInternationalDestination } from "../destination"
import { normalizeHsCode } from "../hs-code-resolution"
import {
  CreateShipmentInput,
  LabelResult,
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

/** Delhivery status-code → human label (mirrors the old route normalizer). */
const STATUS_LABELS: Record<string, string> = {
  UD: "In Transit",
  DL: "Delivered",
  RT: "Returned",
  PP: "Pickup Pending",
  PU: "Picked Up",
  OT: "Out for Delivery",
  NFI: "Not Found",
}

/**
 * Refuse an export up front, with the reason and the way out.
 *
 * This adapter drives Delhivery's Express last-mile API (`/api/cmu/create.json`)
 * — the DOMESTIC product. Delhivery's exports run on Cross Border, a separate
 * Delhivery One service with its own activation, seller KYC (PAN, GST, bank +
 * IFSC, AD code, IEC) and a different order object (shipment type, INCO terms,
 * invoice number/date, IGST payment status, per-item category/HSN/qty/price).
 * None of it is in the Express API at all.
 *
 * Without this guard the domestic endpoint is handed a foreign postcode in
 * `pin` and a `country` it does not serve. Measured against the live account
 * 2026-08-06: serviceability for a US ZIP returns `{"delivery_codes": []}`, and
 * the rate API answers `400 "Unable to process request, Please contact:
 * lastmile-integration@delhivery.com"` — no indication that the real problem is
 * "this carrier has no export product on this account". Fail here instead, so
 * the operator is told to pick a carrier that can actually ship it.
 */
function assertDomestic(country: string | undefined, action: string): void {
  if (!isInternationalDestination(country)) {
    return
  }
  throw new MedusaError(
    MedusaError.Types.NOT_ALLOWED,
    `Delhivery cannot ${action} to ${country} — this integration drives Delhivery's domestic (Express) API, and international exports run on Delhivery Cross Border, which is a separate service. Use Shiprocket for this order, or contact Delhivery to enable Cross Border.`
  )
}

/** "Name × qty" per line, joined; capped so a long order cannot overflow the field. */
export const delhiveryProductDesc = (items: CreateShipmentInput["items"]): string => {
  const text = (items || [])
    .map((i) => (Number(i.quantity) > 1 ? `${i.name} × ${Number(i.quantity)}` : i.name))
    .filter(Boolean)
    .join(", ")
  return text.length > 250 ? `${text.slice(0, 247)}...` : text
}

/**
 * Value of what is actually in the box: Σ unit_price × quantity of the items
 * shipped (a partial shipment declares only its share), else the caller's
 * sub_total. Never sends 0 when either is known.
 */
export const delhiveryDeclaredValue = (input: CreateShipmentInput): number | undefined => {
  const fromItems = (input.items || []).reduce(
    (s, i) => s + (Number(i.unit_price) || 0) * (Number(i.quantity) || 0),
    0
  )
  const value = fromItems > 0 ? fromItems : Number(input.sub_total) || 0
  return value > 0 ? Math.round(value * 100) / 100 : undefined
}

export type DelhiveryPinCodeResult = {
  /** Delhivery delivers to this pin at all (prepaid or COD), and it is not embargoed. */
  serviceable: boolean
  /** Cash on delivery is accepted at this pin. */
  cod: boolean
  prepaid: boolean
}

/**
 * Read `/c/api/pin-codes/json/?filter_codes=` into three answers.
 *
 * The response is `{ delivery_codes: [{ postal_code: { pin, pre_paid, cash,
 * cod, remarks, ... } }] }` with "Y"/"N" flags. An unknown pin comes back as an
 * EMPTY list with HTTP 200, so "no row" means "we don't go there", not an error.
 * `remarks: "Embargo"` is Delhivery saying the pin is temporarily closed.
 * `cod` is the COD flag; older payloads only carry `cash`, so it is the fallback.
 */
export function parseDelhiveryPinCodes(json: any): DelhiveryPinCodeResult {
  const row = json?.delivery_codes?.[0]?.postal_code
  if (!row) return { serviceable: false, cod: false, prepaid: false }
  const yes = (v: any) => String(v ?? "").trim().toUpperCase() === "Y"
  const embargoed = /embargo/i.test(String(row.remarks ?? ""))
  const prepaid = yes(row.pre_paid)
  const cod = yes(row.cod ?? row.cash)
  return {
    serviceable: !embargoed && (prepaid || cod),
    cod: !embargoed && cod,
    prepaid: !embargoed && prepaid,
  }
}

export class DelhiveryProviderAdapter implements ShippingProviderClient {
  readonly carrier = "delhivery"
  private client: DelhiveryClient

  constructor(options: DelhiveryOptions) {
    this.client = new DelhiveryClient(options)
  }

  async checkServiceability(destinationPincode: string): Promise<boolean> {
    const result = await this.client.checkServiceability(destinationPincode)
    return Boolean(result?.delivery_codes?.length)
  }

  /** Serviceable + COD + prepaid for one Indian pin (read-only lookup). */
  async checkPinCode(destinationPincode: string): Promise<DelhiveryPinCodeResult> {
    const result = await this.client.checkServiceability(destinationPincode)
    return parseDelhiveryPinCodes(result)
  }

  async getRates(query: RateQuery): Promise<RateOption[]> {
    // The Kinko invoice API takes two 6-digit INDIAN pincodes and quotes in INR.
    // A foreign destination gets a bare 400 from Delhivery, so classify it here.
    assertDomestic(query.destination_country, "quote a rate")

    const result = await this.client.calculateShippingCost({
      origin_pin: query.origin_pincode,
      destination_pin: query.destination_pincode,
      weight: query.weight_grams,
    })
    const charges = Array.isArray(result) ? result : [result]
    return charges
      .filter(Boolean)
      .map((c: any) => ({
        courier_name: "Delhivery",
        amount: Number(c.total_amount) || 0,
        currency_code: "inr",
        is_recommended: true,
      }))
  }

  async createShipment(input: CreateShipmentInput): Promise<ShipmentResult> {
    assertDomestic(input.to.country, "create a shipment")

    const result = await this.client.createShipment({
      // Delhivery makes `hsn_code` mandatory on order creation alongside
      // `seller_gst_tin`, and it is ONE code per shipment, not one per line —
      // so send the first line that resolves one. `items[].hsn` is filled by
      // the shared variant → inventory item → product → line-metadata chain
      // (#1206); this adapter was dropping it, which is why Delhivery labels
      // carried a GSTIN but never an HSN.
      hsn_code: input.items
        .map((i) => normalizeHsCode(i.hsn))
        .find((h) => !!h),
      waybill: "",
      name: input.to.name,
      phone: input.to.phone,
      address: [input.to.address_1, input.to.address_2].filter(Boolean).join(", "),
      city: input.to.city,
      pin: input.to.pincode,
      state: input.to.state,
      country: input.to.country || "India",
      order_id: input.reference_id,
      payment_mode: input.payment_mode === "cod" ? "COD" : "Pre-paid",
      cod_amount: input.payment_mode === "cod" ? input.cod_amount : 0,
      pickup_location_name: input.pickup_location_name,
      // Itemised: each line with its quantity, so the label and manifest say
      // what is in the box ("6PLY White 36in × 111"), not just a name list.
      product_desc: input.product_description || delhiveryProductDesc(input.items),
      // 🔴 The declared value. It was never sent, so every shipment through this
      // adapter (inventory orders, transfers) showed ₹0.00 on Delhivery's label
      // and dashboard. Same defect #83 fixed for the sales-order fulfillment path.
      total_amount: delhiveryDeclaredValue(input),
      weight: input.weight_grams,
      quantity: input.items.reduce((s, i) => s + i.quantity, 0),
      length: input.dimensions_cm?.length,
      width: input.dimensions_cm?.width,
      height: input.dimensions_cm?.height,
      seller_name: input.from?.name,
      seller_address: input.from?.address_1,
      seller_city: input.from?.city,
      seller_pin: input.from?.pincode,
      seller_state: input.from?.state,
      // Seller GST registration (#348): partner-own → platform-by-country fallback.
      seller_gst_tin: input.tax_id || undefined,
    })

    const awb =
      result?.packages?.[0]?.waybill || result?.upload_wbn || result?.waybill || ""

    return {
      carrier: this.carrier,
      awb,
      tracking_number: awb,
      tracking_url: awb
        ? `https://www.delhivery.com/track/package/${awb}`
        : undefined,
      provider_refs: { waybill: awb },
      raw: result,
    }
  }

  async getLabel(ref: ShipmentRef): Promise<LabelResult> {
    const waybill = ref.awb || ref.provider_refs?.waybill
    if (!waybill) throw new Error("Delhivery getLabel requires a waybill")
    // The printable PDF. Its link is signed for 24 hours only (see client).
    // No link → fall back to the public tracking page, as before, so callers
    // always get something to open; `format` says which one it is.
    const slip = await this.client.getLabel(waybill, { pdf: true })
    const pdf = slip?.packages?.[0]?.pdf_download_link
    return pdf
      ? { label_url: pdf, format: "pdf", raw: slip }
      : {
          label_url: `https://www.delhivery.com/track/package/${waybill}`,
          format: "tracking_page",
          raw: slip,
        }
  }

  async track(ref: ShipmentRef): Promise<TrackingResult> {
    const waybill = ref.awb || ref.provider_refs?.waybill
    if (!waybill) throw new Error("Delhivery track requires a waybill")
    const raw = await this.client.trackShipment(waybill)
    const shipment = raw?.ShipmentData?.[0]?.Shipment || {}
    const status = shipment?.Status || {}
    const scans = shipment?.Scans || []

    const events: TrackingEvent[] = scans.map((s: any) => {
      const detail = s?.ScanDetail || s
      return {
        timestamp: detail?.ScanDateTime || "",
        status: detail?.Instructions || detail?.Scan || "",
        location: detail?.ScannedLocation || "",
        // Carrier status code (e.g. "UD"/"DL") — the partner UI's scanTypeColor
        // keys on these directly, so keep them rather than lowercasing.
        scan_type: detail?.StatusCode || detail?.ScanType || "",
      }
    })
    // Newest first.
    events.sort(
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    )

    const statusType = status.StatusCode || status.StatusType || ""
    return {
      carrier: this.carrier,
      awb: shipment?.AWB || waybill,
      current_status: STATUS_LABELS[statusType] || status.Status || "Unknown",
      current_status_code: statusType,
      estimated_delivery: shipment?.ExpectedDeliveryDate || null,
      origin: shipment?.Origin || undefined,
      destination: shipment?.Destination || undefined,
      events,
      raw,
    }
  }

  async cancelShipment(ref: ShipmentRef): Promise<{ success: boolean; raw?: any }> {
    const waybill = ref.awb || ref.provider_refs?.waybill
    if (!waybill) throw new Error("Delhivery cancelShipment requires a waybill")
    const raw = await this.client.cancelShipment(waybill)
    return { success: raw?.status !== false, raw }
  }

  async schedulePickup(input: SchedulePickupInput): Promise<SchedulePickupResult> {
    if (!input.pickup_date || !input.pickup_time) {
      throw new Error("Delhivery schedulePickup requires pickup_date and pickup_time")
    }
    const raw = await this.client.schedulePickup({
      pickup_date: input.pickup_date,
      pickup_time: input.pickup_time,
      pickup_location: input.pickup_location_name,
      expected_package_count: input.expected_package_count || 1,
    })
    return { scheduled_date: input.pickup_date, raw }
  }

  async registerPickupLocation(
    input: RegisterPickupLocationInput
  ): Promise<{ name: string; raw?: any }> {
    const raw = await this.client.registerWarehouse({
      name: input.name,
      phone: input.phone,
      pin: input.pincode,
      city: input.city,
      address: input.address_1,
      email: input.email,
      state: input.state,
      country: input.country || "India",
    })
    return { name: input.name, raw }
  }
}
