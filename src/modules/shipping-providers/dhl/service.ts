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
import { DHLClient, DHLOptions } from "./client"
import { Logger } from "@medusajs/framework/types"

type InjectedDeps = { logger: Logger }

class DHLExpressFulfillmentService extends AbstractFulfillmentProviderService {
  static identifier = "dhl-express"

  protected client: DHLClient
  protected logger: Logger

  constructor({ logger }: InjectedDeps, options: DHLOptions) {
    super()
    this.logger = logger
    this.client = new DHLClient(options)
  }

  async getFulfillmentOptions(): Promise<FulfillmentOption[]> {
    return [
      { id: "dhl-express-worldwide", name: "DHL Express Worldwide", product_code: "P" },
      { id: "dhl-express-economy", name: "DHL Economy Select", product_code: "H" },
      { id: "dhl-express-domestic", name: "DHL Domestic Express", product_code: "N" },
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

  async canCalculate(data: CreateShippingOptionDTO): Promise<boolean> {
    return true
  }

  async calculatePrice(
    optionData: Record<string, unknown>,
    data: Record<string, unknown>,
    context: any
  ): Promise<CalculatedShippingOptionPrice> {
    try {
      const from = (context as any).from_location?.address || {}
      const to = (context as any).shipping_address || {}
      const items = (context as any).items || []
      const totalWeightKg = items.reduce(
        (sum: number, i: any) => sum + (((i.variant?.weight || 500) * (i.quantity || 1)) / 1000),
        0
      ) || 0.5

      const result = await this.client.getRates({
        origin_country: from.country_code || "DE",
        origin_city: from.city || "",
        origin_postal_code: from.postal_code || "",
        dest_country: to.country_code || "",
        dest_city: to.city || "",
        dest_postal_code: to.postal_code || "",
        weight: totalWeightKg,
      })

      const products = result?.products || []
      const match = products.find(
        (p: any) => p.productCode === (optionData as any).product_code
      ) || products[0]

      const amount = match?.totalPrice?.[0]?.price || 0

      return { calculated_amount: amount, is_calculated_price_tax_inclusive: true }
    } catch (e: any) {
      this.logger.error(`DHL calculatePrice error: ${e.message}`)
      return { calculated_amount: 0, is_calculated_price_tax_inclusive: false }
    }
  }

  async createFulfillment(
    data: Record<string, unknown>,
    items: Partial<Omit<FulfillmentItemDTO, "fulfillment">>[],
    order: Partial<FulfillmentOrderDTO> | undefined,
    fulfillment: Partial<Omit<FulfillmentDTO, "provider_id" | "data" | "items">>
  ): Promise<CreateFulfillmentResult> {
    const shippingAddr = (order as any)?.shipping_address || {}
    const fromLoc = (data as any).from_location || {}
    const totalWeightKg = items.reduce(
      (sum: number, i: any) => sum + (((i.variant?.weight || 500) * (i.quantity || 1)) / 1000),
      0
    ) || 0.5

    const result = await this.client.createShipment({
      shipper: {
        name: fromLoc.name || "Warehouse",
        address: {
          line1: fromLoc.address?.address_1 || "",
          city: fromLoc.address?.city || "",
          postal_code: fromLoc.address?.postal_code || "",
          country_code: fromLoc.address?.country_code || "DE",
        },
        phone: fromLoc.phone || "",
      },
      receiver: {
        name: `${shippingAddr.first_name || ""} ${shippingAddr.last_name || ""}`.trim(),
        address: {
          line1: shippingAddr.address_1 || "",
          city: shippingAddr.city || "",
          postal_code: shippingAddr.postal_code || "",
          country_code: shippingAddr.country_code || "",
        },
        phone: shippingAddr.phone || "",
      },
      packages: [{ weight: totalWeightKg }],
      product_code: (data as any).product_code || "P",
      description: items.map((i: any) => i.title || "Item").join(", "),
    })

    const trackingNumber = result?.shipmentTrackingNumber || ""
    const labelData = result?.documents?.[0]?.content || ""

    return {
      data: {
        tracking_number: trackingNumber,
        carrier: "dhl-express",
        shipment_id: result?.shipmentTrackingNumber,
        ...result,
      },
      labels: [{ tracking_number: trackingNumber, tracking_url: "https://www.dhl.com/en/express/tracking.html?AWB=" + trackingNumber, label_url: "" }],
    }
  }

  async cancelFulfillment(fulfillment: Record<string, any>): Promise<any> {
    this.logger.info(`DHL cancellation requested for ${fulfillment.data?.tracking_number}`)
    return {}
  }

  async createReturnFulfillment(fulfillment: Record<string, any>): Promise<CreateFulfillmentResult> {
    return { data: { carrier: "dhl-express", type: "return" }, labels: [] }
  }
}

export default DHLExpressFulfillmentService
