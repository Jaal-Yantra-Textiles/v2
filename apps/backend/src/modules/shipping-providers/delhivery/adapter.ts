/**
 * Adapts the existing DelhiveryClient to the normalized ShippingProviderClient
 * interface (#31) WITHOUT touching the client itself. Delhivery's create call
 * auto-assigns the waybill, so `createShipment` is a single round-trip; the
 * waybill is the only ref needed for label/track/cancel.
 */
import { MedusaError } from "@medusajs/framework/utils"

import { DelhiveryClient, DelhiveryOptions } from "./client"
import { isInternationalDestination } from "../destination"
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
      hsn_code: input.items.map((i) => i.hsn).find((h) => !!h && String(h).trim()),
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
      product_desc: input.product_description || input.items.map((i) => i.name).join(", "),
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
    const slip = await this.client.getLabel(waybill)
    return {
      label_url: `https://www.delhivery.com/track/package/${waybill}`,
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
