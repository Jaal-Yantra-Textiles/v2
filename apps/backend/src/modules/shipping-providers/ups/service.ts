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
import { UPSClient, UPSOptions } from "./client"
import { Logger } from "@medusajs/framework/types"

type InjectedDeps = { logger: Logger }

class UPSFulfillmentService extends AbstractFulfillmentProviderService {
  static identifier = "ups"

  protected client: UPSClient
  protected logger: Logger

  constructor({ logger }: InjectedDeps, options: UPSOptions) {
    super()
    this.logger = logger
    this.client = new UPSClient(options)
  }

  async getFulfillmentOptions(): Promise<FulfillmentOption[]> {
    return [
      { id: "ups-ground", name: "UPS Ground", service_code: "03" },
      { id: "ups-2nd-day-air", name: "UPS 2nd Day Air", service_code: "02" },
      { id: "ups-next-day-air", name: "UPS Next Day Air", service_code: "01" },
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
          name: "Shipper",
          address: {
            city: from.city || "",
            state: from.province || "",
            postal_code: from.postal_code || "",
            country_code: from.country_code || "US",
          },
        },
        ship_to: {
          name: "Receiver",
          address: {
            city: to.city || "",
            state: to.province || "",
            postal_code: to.postal_code || "",
            country_code: to.country_code || "US",
          },
        },
        packages: [{ weight: totalWeightKg }],
        service_code: (optionData as any).service_code,
      })

      const rated =
        result?.RateResponse?.RatedShipment?.[0]?.TotalCharges?.MonetaryValue
      const amount = rated ? parseFloat(rated) : 0

      return { calculated_amount: amount, is_calculated_price_tax_inclusive: true }
    } catch (e: any) {
      this.logger.error(`UPS calculatePrice error: ${e.message}`)
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
        ship_to: {
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
        service_code: (data as any).service_code || "03",
        description: items.map((i: any) => i.title || "Item").join(", "),
      })

      const trackingNumber =
        result?.ShipmentResponse?.ShipmentResults?.ShipmentIdentificationNumber || ""
      const labelData =
        result?.ShipmentResponse?.ShipmentResults?.PackageResults?.[0]
          ?.ShippingLabel?.GraphicImage || ""

      this.logger.info(`UPS shipment created: tracking=${trackingNumber}`)

      return {
        data: {
          tracking_number: trackingNumber,
          carrier: "ups",
          ...result,
        },
        labels: [{ tracking_number: trackingNumber, tracking_url: "https://www.ups.com/track?tracknum=" + trackingNumber, label_url: "" }],
      }
    } catch (e: any) {
      this.logger.error(`UPS createFulfillment error: ${e.message}`)
      throw e
    }
  }

  async cancelFulfillment(fulfillment: Record<string, any>): Promise<any> {
    const trackingNumber =
      fulfillment.data?.tracking_number || fulfillment.data?.shipment_id
    if (!trackingNumber) {
      return {}
    }

    try {
      const result = await this.client.voidShipment(trackingNumber)
      this.logger.info(`UPS shipment voided: tracking=${trackingNumber}`)
      return result
    } catch (e: any) {
      this.logger.error(`UPS cancelFulfillment error: ${e.message}`)
      throw e
    }
  }

  async createReturnFulfillment(fulfillment: Record<string, any>): Promise<CreateFulfillmentResult> {
    return { data: { carrier: "ups", type: "return" }, labels: [] }
  }
}

export default UPSFulfillmentService
