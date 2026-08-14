import { isInternationalDestination } from "../destination"
import type {
  CreateShipmentInput,
  LabelResult,
  PickupLocation,
  RegisterPickupLocationInput,
  SchedulePickupInput,
  SchedulePickupResult,
  ShipmentRef,
  ShipmentResult,
  ShippingProviderClient,
  TrackingResult,
} from "../provider-interface"
import {
  DhlUnifiedTrackingClient,
  normalizeDhlUnifiedTracking,
} from "../dhl-unified-tracking"
import { BlueDartApiError, BlueDartClient } from "./client"
import {
  BLUEDART_CARRIER_ID,
  BLUEDART_DEFAULT_DIMENSIONS,
  BLUEDART_INTL_SUBPRODUCT,
  BLUEDART_PICKUP_SUBPRODUCTS,
  BLUEDART_PRODUCT,
  gramsToKgString,
  toBlueDartTime,
  toMsJsonDate,
} from "./constants"
import {
  blueDartDigits,
  blueDartField,
  packBlueDartAddress,
} from "./address"
import type { BlueDartConfig } from "./types"

/**
 * Blue Dart as a `ShippingProviderClient`.
 *
 * Why it exists (#1236 / order #83's lineage): some of our pickup locations
 * simply do not work with the incumbent carriers — the pickup never materialises
 * — and Blue Dart serves those lanes. Unlike our Delhivery integration it is
 * NOT domestic-only: product `H` (IPC) is a real export product on the same
 * account, so there is no `assertDomestic` guard here.
 *
 * Two shapes worth knowing before reading on:
 *
 *  - **Waybill and pickup are separate acts.** `createShipment` sends
 *    `RegisterPickup: false` and `schedulePickup` books the collection. A
 *    waybill can be made the night before; a pickup slot is a commitment for a
 *    date and a warehouse. Same split we settled on for Delhivery in #1241.
 *  - **Weights are KG, ours are grams**; dates are Microsoft-JSON, not ISO.
 */
export class BlueDartProviderAdapter implements ShippingProviderClient {
  readonly carrier = BLUEDART_CARRIER_ID
  private readonly client: BlueDartClient
  /** DHL unified tracking, when a key is configured — see `track()`. */
  private readonly tracking?: DhlUnifiedTrackingClient

  constructor(
    cfg: BlueDartConfig | BlueDartClient,
    tracking?: DhlUnifiedTrackingClient
  ) {
    this.client = cfg instanceof BlueDartClient ? cfg : new BlueDartClient(cfg)
    this.tracking = tracking
  }

  /**
   * True when the destination pincode can receive the product we would ship it.
   *
   * Reads the INBOUND flag, not the outbound one: outbound describes what can
   * leave that pincode, which is a fact about the destination's own senders and
   * says nothing about whether our parcel can be delivered there.
   */
  async checkServiceability(destinationPincode: string): Promise<boolean> {
    const result = await this.client.checkServiceability(destinationPincode)
    const yes = (v: any) => String(v || "").trim().toLowerCase() === "yes"
    return (
      yes(result?.DomesticPriorityInbound) ||
      yes(result?.ApexInbound) ||
      yes(result?.GroundInbound)
    )
  }

  async createShipment(input: CreateShipmentInput): Promise<ShipmentResult> {
    const international = isInternationalDestination(input.to.country)
    const dims = input.dimensions_cm
    // Every name and address line is capped at 30 characters and Blue Dart
    // reports a breach as an empty-bodied 400, so pack both addresses before
    // building the request rather than discovering it at the gateway.
    const consignee = packBlueDartAddress(input.to.address_1, input.to.address_2)
    const shipper = packBlueDartAddress(
      input.from?.address_1,
      input.from?.address_2
    )
    // `pickup_location_name` is the fallback the Shipper block has always used,
    // but it is frequently the derived `warehouse-<last8>` handle (#1234) — a
    // routing key rather than a sender a courier should read.
    const shipperName = blueDartField(
      input.from?.name || input.pickup_location_name
    )
    const request: Record<string, any> = {
      Consignee: {
        ConsigneeName: blueDartField(input.to.name),
        // Packed, not truncated: a 43-character street line (order 83's
        // Gandhinagar address) has to wrap onto the optional lines or Blue Dart
        // 400s with an empty body naming nothing.
        ConsigneeAddress1: consignee.line1,
        ConsigneeAddress2: consignee.line2,
        ConsigneeAddress3: consignee.line3,
        ConsigneeAddressType: "R",
        ConsigneeAttention: blueDartField(input.to.name),
        ConsigneeEmailID: input.to.email || "",
        ConsigneeMobile: blueDartDigits(input.to.phone, 15),
        ConsigneePincode: blueDartDigits(input.to.pincode, 6),
        ConsigneeTelephone: "",
        ...(international
          ? {
              ConsigneeCountryCode: String(input.to.country || "").toUpperCase(),
              ConsigneeCityName: input.to.city,
            }
          : {}),
      },
      Shipper: {
        CustomerName: shipperName,
        CustomerCode: this.client.profile.Customercode,
        CustomerAddress1: shipper.line1,
        CustomerAddress2: shipper.line2,
        CustomerAddress3: shipper.line3,
        CustomerEmailID: input.from?.email || "",
        CustomerGSTNumber: input.tax_id || "",
        CustomerMobile: blueDartDigits(input.from?.phone, 15),
        CustomerPincode: blueDartDigits(input.from?.pincode, 6),
        CustomerTelephone: "",
        IsToPayCustomer: false,
        OriginArea: this.client.originArea,
        Sender: shipperName,
        VendorCode: "",
      },
      Returnadds: {
        ReturnAddress1: shipper.line1,
        ReturnAddress2: shipper.line2,
        ReturnAddress3: shipper.line3,
        ReturnContact: shipperName,
        ReturnEmailID: input.from?.email || "",
        ReturnMobile: blueDartDigits(input.from?.phone, 15),
        ReturnPincode: blueDartDigits(input.from?.pincode, 6),
        ReturnTelephone: "",
        ManifestNumber: "",
      },
      Services: {
        AWBNo: "",
        ActualWeight: gramsToKgString(input.weight_grams),
        // COD is collected at the door; a prepaid shipment must send 0, never
        // the order value, or Blue Dart asks the customer to pay twice.
        CollectableAmount:
          input.payment_mode === "cod" ? Number(input.cod_amount) || 0 : 0,
        Commodity: this.commodityOf(input),
        CreditReferenceNo: input.reference_id,
        CreditReferenceNo2: "",
        CreditReferenceNo3: "",
        DeclaredValue: this.declaredValueOf(input),
        // Mandatory. A waybill with no Dimensions array is rejected outright,
        // so an unmeasured parcel falls back to a nominal box rather than
        // failing the shipment.
        Dimensions: [
          {
            Length: dims?.length ?? BLUEDART_DEFAULT_DIMENSIONS.length,
            Breadth: dims?.width ?? BLUEDART_DEFAULT_DIMENSIONS.breadth,
            Height: dims?.height ?? BLUEDART_DEFAULT_DIMENSIONS.height,
            Count: 1,
          },
        ],
        ECCN: "",
        PDFOutputNotRequired: true,
        PackType: "",
        PickupDate: toMsJsonDate(new Date()),
        PickupTime: toBlueDartTime("16:00"),
        PieceCount: "1",
        ProductCode: international
          ? BLUEDART_PRODUCT.international
          : BLUEDART_PRODUCT.domestic,
        ProductType: 0,
        // Booked separately by `schedulePickup` — see the class docblock.
        RegisterPickup: false,
        SpecialInstruction: input.product_description || "",
        SubProductCode: international ? BLUEDART_INTL_SUBPRODUCT : "",
        // "0" (a STRING) disables OTP delivery. The numeric 2 demands an OTPCode
        // and fails with "OTP Number cannot be blank" when one isn't supplied.
        OTPBasedDelivery: "0",
        OTPCode: "",
        itemdtl: international ? this.itemDetailsOf(input) : [],
        noOfDCGiven: 0,
        ...(international ? this.internationalServicesOf(input) : {}),
      },
    }

    const result = await this.client.generateWaybill(request)
    const awb = result?.AWBNo ? String(result.AWBNo) : ""
    if (!awb) {
      throw new BlueDartApiError(
        "Blue Dart accepted the waybill request but returned no AWB",
        [],
        result
      )
    }

    return {
      carrier: this.carrier,
      awb,
      tracking_number: awb,
      tracking_url: `https://www.bluedart.com/tracking?trackFor=0&trackNo=${awb}`,
      provider_refs: {
        waybill: awb,
        mps_numbers: (result.MPSDetails || [])
          .map((m) => m?.MPSNumber)
          .filter(Boolean),
        destination_area: result.DestinationArea,
        // Surfaced because a Blue Dart account ships until the prepaid balance
        // runs out and then simply stops — knowing it is falling is the only
        // early warning there is.
        available_balance: result.AvailableBalance,
        transaction_amount: result.TransactionAmount,
        courier_rate: result.TransactionAmount,
        courier_rate_currency: "INR",
      },
      raw: result,
    }
  }

  /** Customs commodity block. Blue Dart requires the object even domestically. */
  private commodityOf(input: CreateShipmentInput) {
    const codes = input.items
      .map((i) => i.hsn)
      .filter((c): c is string => Boolean(c && String(c).trim()))
    return {
      CommodityDetail1: codes[0] || input.items[0]?.name || "Merchandise",
      CommodityDetail2: codes[1] || "",
      CommodityDetail3: codes[2] || "",
    }
  }

  private declaredValueOf(input: CreateShipmentInput): number {
    if (input.sub_total != null && Number(input.sub_total) > 0) {
      return Number(input.sub_total)
    }
    return input.items.reduce(
      (sum, i) => sum + (Number(i.unit_price) || 0) * (Number(i.quantity) || 1),
      0
    )
  }

  /** Per-item customs lines — mandatory for the international product. */
  private itemDetailsOf(input: CreateShipmentInput) {
    return input.items.map((item, idx) => {
      const qty = Number(item.quantity) || 1
      const unit = Number(item.unit_price) || 0
      return {
        ItemID: item.sku || `ITEM${String(idx + 1).padStart(3, "0")}`,
        ItemName: item.name,
        HSCode: item.hsn || "",
        countryOfOrigin: "IN",
        Itemquantity: qty,
        Unit: "PCS",
        ItemValue: unit,
        TotalValue: unit * qty,
      }
    })
  }

  private internationalServicesOf(input: CreateShipmentInput) {
    return {
      CurrencyCode: (input.currency || "INR").toUpperCase(),
      IsCommercialShipment: input.customs?.commodity !== false,
      IncotermCode: "DAP",
      TermsOfTrade: input.customs?.terms_of_invoice === "CIF" ? "CIF" : "FOB",
      ExportReason:
        input.customs?.reason_of_export === 2 ? "Gift" : "Sale of Goods",
    }
  }

  /**
   * Blue Dart returns the label inline with the waybill only when
   * `PDFOutputNotRequired` is false, and we set it true (the PDF is large and
   * the label is fetched on demand). There is no separate label-fetch endpoint
   * on the documented surface, so this reports that honestly rather than
   * returning an empty result the UI would render as a broken link.
   */
  async getLabel(_ref: ShipmentRef): Promise<LabelResult> {
    throw new BlueDartApiError(
      "Blue Dart does not expose a standalone label fetch — the label PDF is returned with the waybill at creation time. Download it from the Blue Dart portal, or re-generate with PDF output enabled."
    )
  }

  /**
   * Track via DHL's **Unified Shipment Tracking**, not Blue Dart's own endpoint.
   *
   * Both work. Blue Dart's own TnT endpoint authenticates with the SHIPPING
   * licence key (see `client.trackShipment` — the blocker was only ever the
   * `verno` parameter). DHL Unified is preferred for one reason that is not
   * about credentials: **TnT drops cancelled waybills**, answering
   * `"Incorrect waybill number or No information"` — indistinguishable from a
   * typo — while DHL Unified retains their full history, including the
   * shipper-instructed-RTO scan that a cancellation produces.
   *
   * Falls back to Blue Dart's native endpoint when no unified key is configured.
   */
  async track(ref: ShipmentRef): Promise<TrackingResult> {
    const awb = ref.awb || ref.provider_refs?.waybill
    if (!awb) throw new BlueDartApiError("Blue Dart track requires a waybill")

    if (this.tracking) {
      const raw = await this.tracking.track(String(awb), BLUEDART_CARRIER_ID)
      return normalizeDhlUnifiedTracking(raw, String(awb), this.carrier)
    }

    const raw = await this.client.trackShipment(String(awb))
    return normalizeBlueDartTracking(raw, String(awb))
  }

  async cancelShipment(
    ref: ShipmentRef
  ): Promise<{ success: boolean; raw?: any }> {
    const awb = ref.awb || ref.provider_refs?.waybill
    if (!awb) {
      throw new BlueDartApiError("Blue Dart cancelShipment requires a waybill")
    }
    // The client throws on any of Blue Dart's failure shapes, so reaching here
    // means it really was cancelled — `IsError: false` plus a Valid status.
    const raw = await this.client.cancelWaybill(String(awb))
    return { success: true, raw }
  }

  async schedulePickup(input: SchedulePickupInput): Promise<SchedulePickupResult> {
    const awb = input.ref?.awb || input.ref?.provider_refs?.waybill
    if (!awb) {
      throw new BlueDartApiError(
        "Blue Dart schedulePickup requires the shipment's waybill — book the pickup after generating the label."
      )
    }
    const date = input.pickup_date ? new Date(input.pickup_date) : new Date()
    const result = await this.client.registerPickup({
      AWBNo: [String(awb)],
      AreaCode: this.client.originArea,
      CustomerCode: this.client.profile.Customercode,
      CustomerName: input.pickup_location_name,
      CustomerAddress1: input.pickup_location_name,
      CustomerPincode: "",
      CustomerTelephone: "",
      ContactPersonName: input.pickup_location_name,
      ProductCode: BLUEDART_PRODUCT.domestic,
      NumberofPieces: input.expected_package_count || 1,
      WeightofShipment: 0.5,
      VolumeWeight: 0.5,
      ShipmentPickupDate: toMsJsonDate(date),
      // HHMM, not HH:MM. `createShipment` runs its pickup time through
      // `toBlueDartTime` and this path did not, so a UI that sends "14:00" —
      // which both the admin widget and the partner form do — handed Blue Dart
      // a colon it does not parse. Same helper, same format, both paths.
      ShipmentPickupTime: toBlueDartTime(input.pickup_time),
      OfficeCloseTime: toBlueDartTime("18:00"),
      DoxNDox: "1",
      // Must be non-empty — an empty SubProducts array is rejected.
      SubProducts: BLUEDART_PICKUP_SUBPRODUCTS,
      IsForcePickup: false,
      IsReversePickup: false,
      isToPayShipper: false,
      CISDDN: false,
      EmailID: "",
      PackType: "",
      ReferenceNo: String(awb),
      Remarks: "",
      RouteCode: "",
    })
    return {
      scheduled_date: input.pickup_date,
      // The token is what CancelPickup needs later — losing it means the
      // collection can only be called off by phone.
      token: result?.TokenNumber ? String(result.TokenNumber) : undefined,
      raw: result,
    }
  }

  /**
   * Blue Dart has no pickup-location registry: collections are booked per-AWB
   * against the account's origin area, so there is nothing to register or list.
   * Deliberately NOT implemented (rather than faked) — `registerPickupLocation`
   * and `listPickupLocations` are optional on the interface precisely for this,
   * and a stub returning `[]` would make the carrier-pickups UI claim a
   * location is unregistered when registration is not a concept here.
   */
  registerPickupLocation?: (
    input: RegisterPickupLocationInput
  ) => Promise<{ name: string; raw?: any }>
  listPickupLocations?: () => Promise<PickupLocation[]>
}

/**
 * Map Blue Dart's scan list onto our uniform tracking shape.
 *
 * Exported and pure so it can be tested against captured payloads without a
 * live account — which matters more than usual here, since tracking needs a
 * licence key we do not yet hold.
 */
export function normalizeBlueDartTracking(
  raw: any,
  awb: string
): TrackingResult {
  const shipmentData = raw?.ShipmentData ?? raw
  const shipment = Array.isArray(shipmentData?.Shipment)
    ? shipmentData.Shipment[0]
    : shipmentData?.Shipment || shipmentData

  const scans: any[] = Array.isArray(shipment?.Scans)
    ? shipment.Scans
    : Array.isArray(shipment?.Scans?.ScanDetail)
      ? shipment.Scans.ScanDetail
      : []

  const events = scans.map((s: any) => {
    const detail = s?.ScanDetail || s
    const status = detail?.Scan || detail?.ScanType || ""
    return {
      timestamp: [detail?.ScanDate, detail?.ScanTime].filter(Boolean).join(" "),
      status: String(status),
      location: String(detail?.ScannedLocation || detail?.ScannedLocationCode || ""),
      scan_type: classifyBlueDartScan(String(status)),
    }
  })

  const current = shipment?.Status || events[events.length - 1]?.status || ""
  return {
    carrier: BLUEDART_CARRIER_ID,
    awb,
    current_status: String(current),
    current_status_code: shipment?.StatusCode || undefined,
    estimated_delivery: shipment?.ExpectedDeliveryDate || null,
    origin: shipment?.Origin || undefined,
    destination: shipment?.Destination || undefined,
    events,
    raw,
  }
}

/**
 * Coarse classification consumers switch on.
 *
 * An unrecognised live scan maps to `in_transit`, never `delivered` — the same
 * rule the Delhivery normalizer follows (#1206). Guessing "delivered" closes an
 * order whose parcel is still in the network, and that error is not visible
 * until a customer complains.
 */
export function classifyBlueDartScan(status: string): string {
  const s = status.toLowerCase()
  if (/deliver/.test(s) && !/undeliver|out for deliver/.test(s)) return "delivered"
  if (/out for delivery/.test(s)) return "out_for_delivery"
  if (/pick|collect|shipment picked/.test(s)) return "picked_up"
  if (/rto|return/.test(s)) return "returned"
  if (/cancel/.test(s)) return "cancelled"
  if (/undeliver|exception|hold|delay/.test(s)) return "exception"
  return "in_transit"
}
