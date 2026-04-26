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
import { AusPostClient, AusPostOptions } from "./client"
import { Logger } from "@medusajs/framework/types"

type InjectedDeps = { logger: Logger }

class AusPostFulfillmentService extends AbstractFulfillmentProviderService {
  static identifier = "auspost"

  protected client: AusPostClient
  protected logger: Logger

  constructor({ logger }: InjectedDeps, options: AusPostOptions) {
    super()
    this.logger = logger
    this.client = new AusPostClient(options)
  }

  async getFulfillmentOptions(): Promise<FulfillmentOption[]> {
    return [
      { id: "auspost-standard", name: "Australia Post Standard", product_id: "7E55" },
      { id: "auspost-express", name: "Australia Post Express", product_id: "7J55" },
      { id: "auspost-international", name: "Australia Post International", product_id: "ECM8" },
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
        from: {
          suburb: from.city || "",
          postcode: from.postal_code || "",
          state: from.province || "",
          country: from.country_code || "AU",
        },
        to: {
          suburb: to.city || "",
          postcode: to.postal_code || "",
          state: to.province || "",
          country: to.country_code || "AU",
        },
        items: [
          {
            weight: totalWeightKg,
            product_id: (optionData as any).product_id,
          },
        ],
      })

      const shipmentPrice = result?.shipments?.[0]?.items?.[0]?.price
      const amount =
        shipmentPrice != null ? parseFloat(shipmentPrice) : 0

      return { calculated_amount: amount, is_calculated_price_tax_inclusive: true }
    } catch (e: any) {
      this.logger.error(`AusPost calculatePrice error: ${e.message}`)
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
        from: {
          name: fromLoc.name || "Warehouse",
          phone: fromLoc.phone || "",
          suburb: fromLoc.address?.city || "",
          postcode: fromLoc.address?.postal_code || "",
          state: fromLoc.address?.province || "",
          lines: [fromLoc.address?.address_1 || ""].filter(Boolean),
          country: fromLoc.address?.country_code || "AU",
        },
        to: {
          name:
            `${shippingAddr.first_name || ""} ${shippingAddr.last_name || ""}`.trim() ||
            "Customer",
          phone: shippingAddr.phone || "",
          suburb: shippingAddr.city || "",
          postcode: shippingAddr.postal_code || "",
          state: shippingAddr.province || "",
          lines: [shippingAddr.address_1, shippingAddr.address_2].filter(Boolean),
          country: shippingAddr.country_code || "AU",
        },
        items: [
          {
            weight: totalWeightKg,
            product_id: (data as any).product_id || "7E55",
            item_description: items.map((i: any) => i.title || "Item").join(", "),
          },
        ],
      })

      const shipment = result?.shipments?.[0]
      const shipmentId = shipment?.shipment_id || ""
      const trackingId = shipment?.items?.[0]?.tracking_details?.article_id || ""

      this.logger.info(`AusPost shipment created: shipment_id=${shipmentId}, tracking=${trackingId}`)

      // Attempt to fetch the label
      let labelData: string | undefined
      if (shipmentId) {
        try {
          const labelResult = await this.client.getLabel(shipmentId)
          labelData = labelResult?.labels?.[0]?.data
        } catch {
          // Label may not be immediately available
        }
      }

      return {
        data: {
          tracking_number: trackingId,
          shipment_id: shipmentId,
          carrier: "auspost",
          ...result,
        },
        labels: [{ tracking_number: trackingId, tracking_url: "https://auspost.com.au/mypost/track/#/details/" + trackingId, label_url: "" }],
      }
    } catch (e: any) {
      this.logger.error(`AusPost createFulfillment error: ${e.message}`)
      throw e
    }
  }

  async cancelFulfillment(fulfillment: Record<string, any>): Promise<any> {
    // Australia Post does not expose a public cancel API
    // Cancellations are handled through the merchant portal
    this.logger.info(
      `AusPost cancellation requested for shipment_id=${fulfillment.data?.shipment_id}`
    )
    return {}
  }

  async createReturnFulfillment(fulfillment: Record<string, any>): Promise<CreateFulfillmentResult> {
    return { data: { carrier: "auspost", type: "return" }, labels: [] }
  }
}

export default AusPostFulfillmentService
