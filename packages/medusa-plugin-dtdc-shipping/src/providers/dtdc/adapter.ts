import {
  DtdcClient,
  dtdcScanType,
  normalizeDtdcWebhook,
  isPincodeServiceable,
} from "../../lib/dtdc-client"
import { DtdcOptions, DtdcServiceType } from "../../lib/types"
import {
  CreateShipmentInput,
  LabelResult,
  ShipmentRef,
  ShipmentResult,
  ShippingProviderClient,
  TrackingEvent,
  TrackingResult,
} from "../../lib/provider-interface"

/** Service-type inference: large/heavy consignments go surface, else air. */
function serviceTypeFor(input: CreateShipmentInput): DtdcServiceType {
  const length = input.dimensions_cm?.length ?? 0
  const heavy = input.weight_grams >= 10000 || length > 100
  return heavy ? "GROUND_EXPRESS" : "PRIORITY"
}

export class DtdcProviderAdapter implements ShippingProviderClient {
  readonly carrier = "dtdc"
  private client: DtdcClient

  constructor(options: DtdcOptions) {
    this.client = new DtdcClient(options)
  }

  async checkServiceability(destinationPincode: string): Promise<boolean> {
    try {
      // The rate calculator wants an origin pincode. The adapter has no origin
      // context on this call, so serviceability is checked destination-side
      // with a known-good metro origin; callers that need origin accuracy pass
      // the pincode through createShipment instead.
      const result = await this.client.checkPincodeServiceability(
        "110046",
        destinationPincode
      )
      return isPincodeServiceable(result)
    } catch {
      return false
    }
  }

  async createShipment(input: CreateShipmentInput): Promise<ShipmentResult> {
    const result = await this.client.createShipment({
      service_type_id: serviceTypeFor(input),
      length: input.dimensions_cm?.length ?? 30,
      width: input.dimensions_cm?.width ?? 25,
      height: input.dimensions_cm?.height ?? 5,
      weight: input.weight_grams / 1000,
      declared_value: input.sub_total ?? input.cod_amount ?? 500,
      num_pieces: input.items.reduce((s, i) => s + i.quantity, 0),
      origin: input.from
        ? {
            name: input.from.name,
            phone: input.from.phone,
            address_line_1: input.from.address_1,
            address_line_2: input.from.address_2,
            pincode: input.from.pincode,
            city: input.from.city,
            state: input.from.state,
          }
        : {
            name: "Warehouse",
            phone: "",
            address_line_1: "",
            pincode: "",
            city: "",
            state: "",
          },
      destination: {
        name: input.to.name,
        phone: input.to.phone,
        address_line_1: input.to.address_1,
        address_line_2: input.to.address_2,
        pincode: input.to.pincode,
        city: input.to.city,
        state: input.to.state,
      },
      customer_reference_number: input.reference_id,
      cod_collection_mode: input.payment_mode === "cod" ? "CASH" : "",
      cod_amount: input.payment_mode === "cod" ? input.cod_amount : undefined,
      description:
        input.product_description ||
        input.items.map((i) => i.name).join(", "),
    })

    const awb = result?.data?.[0]?.reference_number || ""

    return {
      carrier: this.carrier,
      awb,
      tracking_number: awb,
      tracking_url: awb
        ? `https://www.dtdc.com/tracking.asp?awb=${awb}`
        : undefined,
      provider_refs: { awb },
      raw: result,
    }
  }

  async getLabel(ref: ShipmentRef): Promise<LabelResult> {
    const awb = ref.awb || ref.provider_refs?.awb
    if (!awb) throw new Error("DTDC getLabel requires an AWB number")
    const label = await this.client.getLabel(awb)
    return {
      data: label.data,
      format: label.format,
      raw: label.raw,
    }
  }

  async track(ref: ShipmentRef): Promise<TrackingResult> {
    const awb = ref.awb || ref.provider_refs?.awb
    if (!awb) throw new Error("DTDC track requires an AWB number")
    const raw = await this.client.trackShipment(awb)
    const header = raw?.trackHeader ?? {}
    const trackDetails = raw?.trackDetails ?? []

    const events: TrackingEvent[] = trackDetails.map((e: any) => ({
      timestamp: `${e?.strActionDate ?? ""} ${e?.strActionTime ?? ""}`.trim(),
      status: e?.strAction ?? "",
      location: e?.strOrigin ?? "",
      scan_type: dtdcScanType(e?.strCode, e?.strAction),
    }))

    events.sort(
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    )

    return {
      carrier: this.carrier,
      awb: header?.strShipmentNo || awb,
      current_status: header?.strStatus || "Unknown",
      current_status_code: header?.strCNProduct,
      estimated_delivery: header?.strExpectedDeliveryDate || null,
      origin: header?.strOrigin || undefined,
      destination: header?.strDestination || undefined,
      events,
      raw,
    }
  }

  async cancelShipment(
    ref: ShipmentRef
  ): Promise<{ success: boolean; raw?: any }> {
    const awb = ref.awb || ref.provider_refs?.awb
    if (!awb) throw new Error("DTDC cancelShipment requires an AWB number")
    const raw = await this.client.cancelShipment(awb)
    return { success: raw?.success !== false, raw }
  }

  normalizeWebhook(payload: any): TrackingResult {
    return normalizeDtdcWebhook(payload) as TrackingResult
  }
}