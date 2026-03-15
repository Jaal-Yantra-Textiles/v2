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
import { FedExClient, FedExOptions } from "./client"
import { Logger } from "@medusajs/framework/types"

type InjectedDeps = { logger: Logger }

class FedExFulfillmentService extends AbstractFulfillmentProviderService {
  static identifier = "fedex"

  protected client: FedExClient
  protected logger: Logger

  constructor({ logger }: InjectedDeps, options: FedExOptions) {
    super()
    this.logger = logger
    this.client = new FedExClient(options)
  }

  async getFulfillmentOptions(): Promise<FulfillmentOption[]> {
    return [
      { id: "fedex-ground", name: "FedEx Ground", service_type: "FEDEX_GROUND" },
      { id: "fedex-express-saver", name: "FedEx Express Saver", service_type: "FEDEX_EXPRESS_SAVER" },
      { id: "fedex-priority-overnight", name: "FedEx Priority Overnight", service_type: "PRIORITY_OVERNIGHT" },
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
      const totalWeightKg =
        items.reduce(
          (sum: number, i: any) =>
            sum + (((i.variant?.weight || 500) * (i.quantity || 1)) / 1000),
          0
        ) || 0.5

      const result = await this.client.getRates({
        shipper: {
          postal_code: from.postal_code || "",
          country_code: from.country_code || "US",
          state: from.province || "",
        },
        recipient: {
          postal_code: to.postal_code || "",
          country_code: to.country_code || "US",
          state: to.province || "",
        },
        packages: [{ weight: totalWeightKg }],
        service_type: (optionData as any).service_type,
      })

      const rateDetails =
        result?.output?.rateReplyDetails?.[0]?.ratedShipmentDetails?.[0]
      const amount =
        rateDetails?.totalNetCharge != null
          ? parseFloat(rateDetails.totalNetCharge)
          : 0

      return { calculated_amount: amount, is_calculated_price_tax_inclusive: true }
    } catch (e: any) {
      this.logger.error(`FedEx calculatePrice error: ${e.message}`)
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
    const totalWeightKg =
      items.reduce(
        (sum: number, i: any) =>
          sum + (((i.variant?.weight || 500) * (i.quantity || 1)) / 1000),
        0
      ) || 0.5

    try {
      const result = await this.client.createShipment({
        shipper: {
          name: fromLoc.name || "Warehouse",
          phone: fromLoc.phone || "",
          address: {
            line1: fromLoc.address?.address_1 || "",
            city: fromLoc.address?.city || "",
            state: fromLoc.address?.province || "",
            postal_code: fromLoc.address?.postal_code || "",
            country_code: fromLoc.address?.country_code || "US",
          },
        },
        recipient: {
          name:
            `${shippingAddr.first_name || ""} ${shippingAddr.last_name || ""}`.trim() ||
            "Customer",
          phone: shippingAddr.phone || "",
          address: {
            line1: shippingAddr.address_1 || "",
            city: shippingAddr.city || "",
            state: shippingAddr.province || "",
            postal_code: shippingAddr.postal_code || "",
            country_code: shippingAddr.country_code || "US",
          },
        },
        packages: [{ weight: totalWeightKg }],
        service_type: (data as any).service_type || "FEDEX_GROUND",
        description: items.map((i: any) => i.title || "Item").join(", "),
      })

      const trackingNumber =
        result?.output?.transactionShipments?.[0]?.masterTrackingNumber
          ?.trackingNumber || ""
      const labelData =
        result?.output?.transactionShipments?.[0]?.pieceResponses?.[0]
          ?.packageDocuments?.[0]?.encodedLabel || ""

      this.logger.info(`FedEx shipment created: tracking=${trackingNumber}`)

      return {
        data: {
          tracking_number: trackingNumber,
          carrier: "fedex",
          ...result,
        },
        labels: [{ tracking_number: trackingNumber, tracking_url: "https://www.fedex.com/fedextrack/?trknbr=" + trackingNumber, label_url: "" }],
      }
    } catch (e: any) {
      this.logger.error(`FedEx createFulfillment error: ${e.message}`)
      throw e
    }
  }

  async cancelFulfillment(fulfillment: Record<string, any>): Promise<any> {
    const trackingNumber = fulfillment.data?.tracking_number
    if (!trackingNumber) {
      return {}
    }

    try {
      const result = await this.client.cancelShipment(trackingNumber)
      this.logger.info(`FedEx shipment cancelled: tracking=${trackingNumber}`)
      return result
    } catch (e: any) {
      this.logger.error(`FedEx cancelFulfillment error: ${e.message}`)
      throw e
    }
  }

  async createReturnFulfillment(fulfillment: Record<string, any>): Promise<CreateFulfillmentResult> {
    return { data: { carrier: "fedex", type: "return" }, labels: [] }
  }
}

export default FedExFulfillmentService
