import { AbstractFulfillmentProviderService } from "@medusajs/framework/utils"
import {
  CreateFulfillmentResult,
  FulfillmentOption,
  FulfillmentItemDTO,
  FulfillmentOrderDTO,
  FulfillmentDTO,
  CalculatedShippingOptionPrice,
  CreateShippingOptionDTO,
} from "@medusajs/framework/types"
import { DtdcClient } from "../../lib/dtdc-client"
import { DtdcOptions } from "../../lib/types"
import { Logger } from "@medusajs/framework/types"

type InjectedDeps = { logger: Logger }

/**
 * DTDC fulfillment provider service.
 *
 * Extends AbstractFulfillmentProviderService so Medusa's fulfillment module
 * can dispatch createFulfillment / cancelFulfillment through it. Mirrors the
 * Delhivery service structure.
 */
class DtdcFulfillmentService extends AbstractFulfillmentProviderService {
  static identifier = "dtdc"

  protected client: DtdcClient
  protected logger: Logger

  constructor({ logger }: InjectedDeps, options: DtdcOptions) {
    super()
    this.logger = logger
    this.client = new DtdcClient(options)
  }

  async getFulfillmentOptions(): Promise<FulfillmentOption[]> {
    return [
      {
        id: "dtdc-ground-express",
        name: "DTDC Ground Express",
        mode: "Surface",
        is_return: false,
      },
      {
        id: "dtdc-ground-express-return",
        name: "DTDC Ground Express - Return",
        mode: "Surface",
        is_return: true,
      },
      {
        id: "dtdc-priority",
        name: "DTDC Priority",
        mode: "Express",
        is_return: false,
      },
      {
        id: "dtdc-priority-return",
        name: "DTDC Priority - Return",
        mode: "Express",
        is_return: true,
      },
    ]
  }

  async validateFulfillmentData(
    optionData: Record<string, unknown>,
    data: Record<string, unknown>,
    context: any
  ): Promise<Record<string, unknown>> {
    return { ...data, ...optionData }
  }

  async validateOption(data: Record<string, any>): Promise<boolean> {
    return true
  }

  /**
   * 🔴 DTDC can NEVER back a calculated shipping option (#1422).
   *
   * This integration has no rate API — `carrier-capabilities.ts` records dtdc
   * as `can_rate: false` on both domestic and international, and the client
   * exposes no `getRates`. There is nothing to calculate from.
   *
   * It used to answer `true` here and `{ calculated_amount: 0 }` below. A zero
   * is not "we could not quote": it is indistinguishable from a genuinely free
   * lane, so the cart, the order and every downstream report read it as free
   * shipping and the buyer was charged nothing to ship. That is the same
   * defect #1417 found on Shiprocket, whose header comment
   * (`modules/shipping-providers/shiprocket/flat-fallback.ts`) is the fullest
   * account of why a silent zero is the worst available answer.
   *
   * Refusing here is what stops a calculated dtdc option being created at all.
   */
  async canCalculate(_data: CreateShippingOptionDTO): Promise<boolean> {
    return false
  }

  /**
   * Unreachable through a correctly-created option, because `canCalculate`
   * refuses. It throws rather than returning a number for the one case that
   * can still reach it: a calculated option created BEFORE this fix.
   *
   * ⚠️ The trade is deliberate and it is not the same trade Shiprocket made.
   * Shiprocket falls back to a flat rate because its failures are transient —
   * a live rate API having a bad day — and a throw would take the whole
   * shipping-options listing with it, including the manual flat option. DTDC
   * has no rate API at ALL, so a calculated dtdc option is a standing
   * misconfiguration rather than an outage, and there is no honest number to
   * substitute: any flat amount invented here would be a price nobody chose,
   * quoted to a buyer as if a carrier had said it. Failing loudly is what gets
   * the option corrected; quoting zero is what shipped freight for free.
   */
  async calculatePrice(
    _optionData: Record<string, unknown>,
    _data: Record<string, unknown>,
    _context: any
  ): Promise<CalculatedShippingOptionPrice> {
    throw new Error(
      "DTDC cannot price a calculated shipping option: this integration has no rate API (can_rate: false). " +
        "Use a flat-rate shipping option for DTDC, or rate the lane with a carrier that quotes. " +
        "Returning 0 here would quote the buyer free shipping (#1422)."
    )
  }

  async createFulfillment(
    data: Record<string, unknown>,
    items: Partial<Omit<FulfillmentItemDTO, "fulfillment">>[],
    order: Partial<FulfillmentOrderDTO> | undefined,
    fulfillment: Partial<Omit<FulfillmentDTO, "provider_id" | "data" | "items">>
  ): Promise<CreateFulfillmentResult> {
    const shippingAddress = (order as any)?.shipping_address || {}
    const fromLocation = (data as any).from_location || {}

    try {
      const productDesc = items.map((i: any) => i.title || "Item").join(", ")
      const totalQuantity = items.reduce(
        (sum: number, item: any) => sum + ((item as any).quantity || 1),
        0
      )

      const orderItems = ((order as any)?.items || []) as any[]
      const orderItemById = new Map<string, any>()
      for (const oi of orderItems) {
        if (oi.id) orderItemById.set(oi.id, oi)
      }

      let totalWeight = 0
      let maxLength = 0
      let maxWidth = 0
      let maxHeight = 0
      let hasActualWeight = false

      for (const fItem of items) {
        const qty = (fItem as any).quantity || 1
        const orderItem = orderItemById.get((fItem as any).line_item_id)
        const variant = orderItem?.variant

        if (variant?.weight) {
          hasActualWeight = true
          totalWeight += variant.weight * qty
        }

        if (variant?.length && variant.length > maxLength) maxLength = variant.length
        if (variant?.width && variant.width > maxWidth) maxWidth = variant.width
        if (variant?.height) maxHeight += variant.height * qty
      }

      if (!hasActualWeight) {
        if (totalQuantity <= 1) totalWeight = 400
        else if (totalQuantity <= 2) totalWeight = 800
        else if (totalQuantity <= 3) totalWeight = 1200
        else if (totalQuantity <= 5) totalWeight = 2000
        else if (totalQuantity <= 10) totalWeight = 3500
        else totalWeight = totalQuantity * 500

        if (!maxLength) maxLength = 30
        if (!maxWidth) maxWidth = 25
        if (!maxHeight) maxHeight = Math.max(3, totalQuantity * 2)

        this.logger.warn(
          `DTDC: no variant weight set — using bracket estimate: ` +
          `${totalWeight}g for ${totalQuantity} items`
        )
      }

      const paymentStatus = (order as any)?.payment_status
      const isCod = paymentStatus !== "captured" && paymentStatus !== "paid"
      const declaredValue = items.reduce((sum: number, item: any) => {
        const oi = orderItemById.get((item as any).line_item_id)
        const unitPrice = oi?.unit_price ?? oi?.variant?.price ?? 0
        return sum + unitPrice * ((item as any).quantity || 1)
      }, 0)

      const serviceType = (data?.service_type as any) ?? "PRIORITY"
      const result = await this.client.createShipment({
        service_type_id: serviceType,
        length: maxLength || 30,
        width: maxWidth || 25,
        height: maxHeight || 5,
        weight: (totalWeight || 500) / 1000,
        declared_value: declaredValue || 500,
        num_pieces: totalQuantity,
        origin: {
          name: fromLocation.name || "Warehouse",
          phone: fromLocation.address?.phone || "",
          address_line_1: fromLocation.address?.address_1 || "",
          address_line_2: fromLocation.address?.address_2 || "",
          pincode: fromLocation.address?.postal_code || "",
          city: fromLocation.address?.city || "",
          state: fromLocation.address?.province || "",
        },
        destination: {
          name: `${shippingAddress.first_name || ""} ${shippingAddress.last_name || ""}`.trim() || "Customer",
          phone: shippingAddress.phone || "",
          address_line_1: shippingAddress.address_1 || "",
          address_line_2: shippingAddress.address_2 || "",
          pincode: shippingAddress.postal_code || "",
          city: shippingAddress.city || "",
          state: shippingAddress.province || "",
        },
        customer_reference_number: (order as any)?.id || fulfillment.id || "",
        cod_collection_mode: isCod ? "CASH" : "",
        cod_amount: isCod ? declaredValue : undefined,
        description: productDesc,
      })

      const awb =
        result?.data?.[0]?.reference_number ||
        result?.data?.[0]?.consignment_no ||
        result?.data?.[0]?.awb_no ||
        ""

      this.logger.info(`DTDC shipment created: awb=${awb}`)

      return {
        data: {
          waybill: awb,
          tracking_number: awb,
          carrier: "dtdc",
          ...result,
        },
        labels: awb
          ? [{
              tracking_number: awb,
              tracking_url: `https://www.dtdc.com/tracking.asp?awb=${awb}`,
              label_url: "",
            }]
          : [],
      }
    } catch (e: any) {
      this.logger.error(`DTDC createFulfillment error: ${e.message}`)
      throw e
    }
  }

  async cancelFulfillment(fulfillment: Record<string, any>): Promise<any> {
    const awb = fulfillment.data?.waybill || fulfillment.data?.tracking_number
    if (!awb) {
      return {}
    }

    try {
      const result = await this.client.cancelShipment(awb)
      this.logger.info(`DTDC shipment cancelled: awb=${awb}`)
      return result
    } catch (e: any) {
      this.logger.error(`DTDC cancelFulfillment error: ${e.message}`)
      throw e
    }
  }

  async createReturnFulfillment(fulfillment: Record<string, any>): Promise<CreateFulfillmentResult> {
    return {
      data: { carrier: "dtdc", type: "return" },
      labels: [],
    }
  }
}

export default DtdcFulfillmentService
