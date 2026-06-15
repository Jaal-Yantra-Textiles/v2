import { AbstractFulfillmentProviderService } from "@medusajs/framework/utils"
import {
  CreateFulfillmentResult,
  FulfillmentOption,
  FulfillmentItemDTO,
  FulfillmentOrderDTO,
  FulfillmentDTO,
  CalculatedShippingOptionPrice,
  CreateShippingOptionDTO,
  Logger,
} from "@medusajs/framework/types"
import { ShiprocketClient, ShiprocketOptions } from "./client"
import { CreateShipmentInput, ShipmentItem } from "../provider-interface"

type InjectedDeps = { logger: Logger }

/**
 * Shiprocket fulfillment provider (#31).
 *
 * Registered as a Medusa fulfillment provider alongside Delhivery. The heavy
 * lifting lives in ShiprocketClient (which also implements our normalized
 * ShippingProviderClient, so the carrier-keyed resolver can drive it directly
 * from admin/partner routes). This service is the Medusa-fulfilment-flow entry
 * point — createFulfillment maps Medusa's fulfillment DTOs onto the client.
 */
class ShiprocketFulfillmentService extends AbstractFulfillmentProviderService {
  static identifier = "shiprocket"

  protected client: ShiprocketClient
  protected logger: Logger

  constructor({ logger }: InjectedDeps, options: ShiprocketOptions) {
    super()
    this.logger = logger
    this.client = new ShiprocketClient(options)
  }

  async getFulfillmentOptions(): Promise<FulfillmentOption[]> {
    return [
      { id: "shiprocket-standard", name: "Shiprocket (Recommended)", is_return: false },
      { id: "shiprocket-standard-return", name: "Shiprocket - Return", is_return: true },
    ]
  }

  async validateFulfillmentData(
    optionData: Record<string, unknown>,
    data: Record<string, unknown>,
    _context: any
  ): Promise<Record<string, unknown>> {
    return { ...data, ...optionData }
  }

  async validateOption(_data: Record<string, any>): Promise<boolean> {
    return true
  }

  async canCalculate(_data: CreateShippingOptionDTO): Promise<boolean> {
    return true
  }

  async calculatePrice(
    _optionData: Record<string, unknown>,
    _data: Record<string, unknown>,
    context: any
  ): Promise<CalculatedShippingOptionPrice> {
    try {
      const originPin = String(context?.from_location?.address?.postal_code || "")
      const destPin = String(context?.shipping_address?.postal_code || "")
      const isValidPin = (p: string) => /^\d{6}$/.test(p)
      if (!isValidPin(originPin) || !isValidPin(destPin)) {
        return { calculated_amount: 0, is_calculated_price_tax_inclusive: false }
      }

      const items = (context?.items || []) as any[]
      let totalWeight = 0
      let totalQty = 0
      let hasWeight = false
      for (const item of items) {
        const qty = item.quantity || 1
        totalQty += qty
        if (item.variant?.weight) {
          hasWeight = true
          totalWeight += item.variant.weight * qty
        }
      }
      if (!hasWeight) totalWeight = Math.max(400, totalQty * 400)

      const rates = await this.client.getRates({
        origin_pincode: originPin,
        destination_pincode: destPin,
        weight_grams: totalWeight,
      })
      const recommended = rates.find((r) => r.is_recommended) || rates[0]
      return {
        calculated_amount: recommended?.amount || 0,
        is_calculated_price_tax_inclusive: true,
      }
    } catch (e: any) {
      this.logger.error(`Shiprocket calculatePrice error: ${e.message}`)
      return { calculated_amount: 0, is_calculated_price_tax_inclusive: false }
    }
  }

  async createFulfillment(
    data: Record<string, unknown>,
    items: Partial<Omit<FulfillmentItemDTO, "fulfillment">>[],
    order: Partial<FulfillmentOrderDTO> | undefined,
    fulfillment: Partial<Omit<FulfillmentDTO, "provider_id" | "data" | "items">>
  ): Promise<CreateFulfillmentResult> {
    const shippingAddress = (order as any)?.shipping_address || {}
    const fromLocation = (data as any).from_location || {}

    // Weight/dims from order line-item variants (same approach as Delhivery).
    const orderItems = ((order as any)?.items || []) as any[]
    const orderItemById = new Map<string, any>()
    for (const oi of orderItems) if (oi.id) orderItemById.set(oi.id, oi)

    let totalWeight = 0
    let maxLength = 0
    let maxWidth = 0
    let maxHeight = 0
    let hasWeight = false
    const shipItems: ShipmentItem[] = []

    for (const fItem of items) {
      const qty = (fItem as any).quantity || 1
      const oi = orderItemById.get((fItem as any).line_item_id)
      const variant = oi?.variant
      if (variant?.weight) {
        hasWeight = true
        totalWeight += variant.weight * qty
      }
      if (variant?.length && variant.length > maxLength) maxLength = variant.length
      if (variant?.width && variant.width > maxWidth) maxWidth = variant.width
      if (variant?.height) maxHeight += variant.height * qty

      shipItems.push({
        name: (fItem as any).title || oi?.title || "Item",
        sku: oi?.variant_sku || undefined,
        quantity: qty,
        unit_price: oi?.unit_price || 0,
      })
    }

    if (!hasWeight) {
      const totalQty = shipItems.reduce((s, i) => s + i.quantity, 0)
      totalWeight = Math.max(400, totalQty * 400)
      if (!maxLength) maxLength = 30
      if (!maxWidth) maxWidth = 25
      if (!maxHeight) maxHeight = Math.max(3, totalQty * 2)
    }

    const paymentStatus = (order as any)?.payment_status
    const isPrepaid = paymentStatus === "captured" || paymentStatus === "paid"
    const subTotal = shipItems.reduce((s, i) => s + i.unit_price * i.quantity, 0)

    const input: CreateShipmentInput = {
      reference_id: (order as any)?.id || fulfillment.id || "",
      payment_mode: isPrepaid ? "prepaid" : "cod",
      cod_amount: isPrepaid ? undefined : subTotal,
      pickup_location_name:
        fromLocation.metadata?.shiprocket_pickup_location ||
        fromLocation.name ||
        "Primary",
      to: {
        name:
          `${shippingAddress.first_name || ""} ${shippingAddress.last_name || ""}`.trim() ||
          "Customer",
        phone: shippingAddress.phone || "",
        email: (order as any)?.email || undefined,
        address_1: shippingAddress.address_1 || "",
        address_2: shippingAddress.address_2 || undefined,
        city: shippingAddress.city || "",
        state: shippingAddress.province || "",
        pincode: shippingAddress.postal_code || "",
        country: shippingAddress.country_code || "India",
      },
      items: shipItems,
      weight_grams: totalWeight,
      dimensions_cm: { length: maxLength, width: maxWidth, height: maxHeight },
      sub_total: subTotal,
    }

    try {
      const result = await this.client.createShipment(input)
      this.logger.info(`Shiprocket shipment created: awb=${result.awb}`)
      return {
        data: {
          carrier: "shiprocket",
          waybill: result.awb,
          tracking_number: result.tracking_number,
          ...result.provider_refs,
          ...result.raw,
        },
        labels: result.awb
          ? [
              {
                tracking_number: result.tracking_number,
                tracking_url: result.tracking_url || "",
                label_url: result.label_url || "",
              },
            ]
          : [],
      }
    } catch (e: any) {
      this.logger.error(`Shiprocket createFulfillment error: ${e.message}`)
      throw e
    }
  }

  async cancelFulfillment(fulfillment: Record<string, any>): Promise<any> {
    const srOrderId = fulfillment.data?.sr_order_id
    if (!srOrderId) return {}
    try {
      return await this.client.cancelShipment({
        provider_refs: { sr_order_id: srOrderId },
      })
    } catch (e: any) {
      this.logger.error(`Shiprocket cancelFulfillment error: ${e.message}`)
      throw e
    }
  }

  async createReturnFulfillment(
    _fulfillment: Record<string, any>
  ): Promise<CreateFulfillmentResult> {
    // Return orders use Shiprocket's separate return-order create; stubbed for
    // the spike (P4 scope alongside the COD/remittance loop).
    return { data: { carrier: "shiprocket", type: "return" }, labels: [] }
  }
}

export default ShiprocketFulfillmentService
