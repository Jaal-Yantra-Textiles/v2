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
import { DelhiveryClient, DelhiveryOptions } from "./client"
import { Logger } from "@medusajs/framework/types"

type InjectedDeps = { logger: Logger }

class DelhiveryFulfillmentService extends AbstractFulfillmentProviderService {
  static identifier = "delhivery"

  protected client: DelhiveryClient
  protected logger: Logger

  constructor({ logger }: InjectedDeps, options: DelhiveryOptions) {
    super()
    this.logger = logger
    this.client = new DelhiveryClient(options)
  }

  async getFulfillmentOptions(): Promise<FulfillmentOption[]> {
    return [
      {
        id: "delhivery-surface-standard",
        name: "Delhivery Standard (Surface)",
        mode: "Surface",
        is_return: false,
      },
      {
        id: "delhivery-surface-return",
        name: "Delhivery Standard (Surface) - Return",
        mode: "Surface",
        is_return: true,
      },
      {
        id: "delhivery-express",
        name: "Delhivery Express",
        mode: "Express",
        is_return: false,
      },
      {
        id: "delhivery-express-return",
        name: "Delhivery Express - Return",
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
    // Validate that the destination pincode is serviceable
    const pin = (data.shipping_address as any)?.postal_code || data.postal_code
    if (pin) {
      try {
        const result = await this.client.checkServiceability(String(pin))
        if (!result?.delivery_codes?.length) {
          throw new Error(`Pincode ${pin} is not serviceable by Delhivery`)
        }
      } catch (e: any) {
        this.logger.warn(`Delhivery serviceability check failed: ${e.message}`)
      }
    }
    return { ...data, ...optionData }
  }

  async validateOption(data: Record<string, any>): Promise<boolean> {
    return true
  }

  async canCalculate(data: CreateShippingOptionDTO): Promise<boolean> {
    return true
  }

  async calculatePrice(
    optionData: Record<string, unknown>,
    data: Record<string, unknown>,
    context: any
  ): Promise<CalculatedShippingOptionPrice> {
    try {
      const fromLocation = (context as any).from_location
      const originPin = String(fromLocation?.address?.postal_code || "")
      const shippingAddress = (context as any).shipping_address
      const destPin = String(shippingAddress?.postal_code || "")

      this.logger.info(`Delhivery calculatePrice: origin=${originPin}, dest=${destPin}`)

      // Delhivery requires valid 6-digit Indian pincodes
      const isValidPin = (pin: string) => /^\d{6}$/.test(pin)

      if (!isValidPin(originPin) || !isValidPin(destPin)) {
        this.logger.warn(
          `Delhivery calculatePrice: invalid pincodes (origin=${originPin}, dest=${destPin}). ` +
          `Delhivery requires 6-digit Indian pincodes.`
        )
        return { calculated_amount: 0, is_calculated_price_tax_inclusive: false }
      }

      // Estimate total weight from items (grams), minimum 1g
      const items = (context as any).items || []
      const totalWeight = items.reduce(
        (sum: number, item: any) => sum + ((item.variant?.weight || 500) * (item.quantity || 1)),
        0
      )

      const result = await this.client.calculateShippingCost({
        origin_pin: originPin,
        destination_pin: destPin,
        weight: totalWeight || 500,
      })

      // Delhivery returns an array of charge objects
      const charges = Array.isArray(result) ? result : [result]
      const charge = charges[0]?.total_amount || 0

      this.logger.info(`Delhivery calculatePrice result: ${charge}`)

      return {
        calculated_amount: charge,
        is_calculated_price_tax_inclusive: true,
      }
    } catch (e: any) {
      this.logger.error(`Delhivery calculatePrice error: ${e.message}`)
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

    try {
      const waybill = await this.client.fetchWaybill()
      const productDesc = items.map((i: any) => i.title || "Item").join(", ")
      const totalWeight = items.reduce(
        (sum: number, item: any) => sum + ((item.variant?.weight || 500) * (item.quantity || 1)),
        0
      )

      const result = await this.client.createShipment({
        waybill,
        name: `${shippingAddress.first_name || ""} ${shippingAddress.last_name || ""}`.trim() || "Customer",
        phone: shippingAddress.phone || "",
        address: [shippingAddress.address_1, shippingAddress.address_2].filter(Boolean).join(", "),
        city: shippingAddress.city || "",
        pin: shippingAddress.postal_code || "",
        state: shippingAddress.province || "",
        country: shippingAddress.country_code || "India",
        order_id: (order as any)?.id || fulfillment.id || "",
        payment_mode: "Pre-paid",
        product_desc: productDesc,
        weight: totalWeight || 500,
        seller_name: fromLocation.name || "",
        seller_address: fromLocation.address?.address_1 || "",
        seller_city: fromLocation.address?.city || "",
        seller_pin: fromLocation.address?.postal_code || "",
        seller_state: fromLocation.address?.province || "",
      })

      this.logger.info(`Delhivery shipment created: waybill=${waybill}`)

      let labelUrl: string | undefined
      try {
        labelUrl = await this.client.getLabel(waybill)
      } catch {
        // Label may not be immediately available
      }

      return {
        data: {
          waybill,
          tracking_number: waybill,
          carrier: "delhivery",
          ...result,
        },
        labels: [{ tracking_number: waybill, tracking_url: "https://www.delhivery.com/track/package/" + waybill, label_url: labelUrl || "" }],
      }
    } catch (e: any) {
      this.logger.error(`Delhivery createFulfillment error: ${e.message}`)
      throw e
    }
  }

  async cancelFulfillment(fulfillment: Record<string, any>): Promise<any> {
    const waybill = fulfillment.data?.waybill || fulfillment.data?.tracking_number
    if (!waybill) {
      return {}
    }

    try {
      const result = await this.client.cancelShipment(waybill)
      this.logger.info(`Delhivery shipment cancelled: waybill=${waybill}`)
      return result
    } catch (e: any) {
      this.logger.error(`Delhivery cancelFulfillment error: ${e.message}`)
      throw e
    }
  }

  async createReturnFulfillment(fulfillment: Record<string, any>): Promise<CreateFulfillmentResult> {
    // Delhivery reverse pickups are handled through their portal
    // Return a stub — merchant handles return logistics
    return {
      data: { carrier: "delhivery", type: "return" },
      labels: [],
    }
  }
}

export default DelhiveryFulfillmentService
