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
import { DHLClient, DHLOptions } from "./client"
import { declaredValueForShipment } from "../delhivery/declared-value"

type InjectedDeps = { logger: Logger }

/** Textile fallback when a variant carries no HS code (HS 6304.92 — cotton furnishings). */
const DEFAULT_HS_CODE = "6304.92"

/** DHL bills international shipments at a 0.5 kg minimum. */
const MIN_WEIGHT_KG = 0.5

function hsCodeFor(orderItem: any): string {
  const metadata = orderItem?.variant?.metadata || orderItem?.metadata || {}
  return metadata.hs_code || metadata.hsCode || metadata.HSCode || DEFAULT_HS_CODE
}

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
    // Real IN-origin products returned by the sandbox for international lanes.
    // "H" (Economy Select) and "N" (Domestic) are not available out of India.
    return [
      { id: "dhl-express-worldwide", name: "DHL Express Worldwide", product_code: "P" },
      { id: "dhl-express-1200", name: "DHL Express 12:00", product_code: "Y" },
      { id: "dhl-express-easy", name: "DHL Express Easy", product_code: "8" },
    ]
  }

  async validateFulfillmentData(
    optionData: Record<string, unknown>,
    data: Record<string, unknown>,
    context: any
  ): Promise<Record<string, unknown>> {
    const shippingAddress = (data as any).shipping_address || {}
    const country = shippingAddress.country_code
    const postal = shippingAddress.postal_code
    const city = shippingAddress.city
    if (country && postal && city) {
      try {
        const result = await this.client.addressValidate({
          type: "delivery",
          country_code: country,
          postal_code: postal,
          city,
        })
        if (!result?.address?.length) {
          throw new Error(`Destination ${city} ${postal} ${country} is not serviceable by DHL`)
        }
      } catch (e: any) {
        this.logger.warn(`DHL serviceability check failed: ${e.message}`)
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
      const from = (context as any).from_location?.address || {}
      const to = (context as any).shipping_address || {}
      const items = (context as any).items || []

      const totalWeightKg = this.weightInKg(items)

      const result = await this.client.getRates({
        origin_country: from.country_code || "IN",
        origin_city: from.city || "",
        origin_postal_code: from.postal_code || "",
        dest_country: to.country_code || "",
        dest_city: to.city || "",
        dest_postal_code: to.postal_code || "",
        weight: totalWeightKg,
        is_customs_declarable: from.country_code !== to.country_code,
      })

      const products = result?.products || []
      const productCode = (optionData as any).product_code
      const match =
        products.find((p: any) => p.productCode === productCode) || products[0]

      const billc = (match?.totalPrice || []).find(
        (p: any) => p.currencyType === "BILLC"
      )
      const amount = billc?.price ?? match?.totalPrice?.[0]?.price ?? 0

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
    const fromAddress = fromLoc.address || {}

    const orderItems = ((order as any)?.items || []) as any[]
    const orderItemById = new Map<string, any>()
    for (const oi of orderItems) {
      if (oi.id) orderItemById.set(oi.id, oi)
    }

    const totalWeightKg = this.weightInKgFromFulfillment(items, orderItemById)

    const originCountry = fromAddress.country_code || "IN"
    const destCountry = shippingAddr.country_code || ""
    const isCustomsDeclarable = Boolean(originCountry) && Boolean(destCountry) && originCountry !== destCountry

    const declaredValue = declaredValueForShipment({
      items: items as any[],
      orderItemById,
      order: order as any,
    })

    const lineItems = items.map((item: any, i) => {
      const orderItem = item?.line_item_id ? orderItemById.get(item.line_item_id) : undefined
      const qty = Number(item?.quantity) || 1
      const price = this.amountOf(
        orderItem?.unit_price ?? orderItem?.price ?? 0
      )
      return {
        description: orderItem?.title || item?.title || "Textile goods",
        price,
        quantity: qty,
        hs_code: hsCodeFor(orderItem),
        weight_kg: Math.max(MIN_WEIGHT_KG, ((orderItem?.variant?.weight || 500) * qty) / 1000),
        manufacturer_country: originCountry,
      }
    })

    const result = await this.client.createShipment({
      shipper: {
        name: fromLoc.name || "Warehouse",
        address: {
          line1: fromAddress.address_1 || fromAddress.address_line1 || "",
          city: fromAddress.city || "",
          postal_code: fromAddress.postal_code || "",
          country_code: originCountry,
        },
        phone: fromLoc.phone || "",
        email: fromLoc.email || "",
      },
      receiver: {
        name: `${shippingAddr.first_name || ""} ${shippingAddr.last_name || ""}`.trim() || "Customer",
        address: {
          line1: [shippingAddr.address_1, shippingAddr.address_2].filter(Boolean).join(", "),
          city: shippingAddr.city || "",
          postal_code: shippingAddr.postal_code || "",
          country_code: destCountry,
        },
        phone: shippingAddr.phone || "",
        email: shippingAddr.email || "",
      },
      packages: [{ weight: totalWeightKg }],
      product_code: (data as any).product_code || "P",
      description: items.map((i: any) => i.title || "Item").join(", ") || "Textile goods",
      is_customs_declarable: isCustomsDeclarable,
      declared_value: declaredValue,
      declared_value_currency: (order as any)?.currency_code || "EUR",
      items: isCustomsDeclarable ? lineItems : undefined,
    })

    const trackingNumber = result?.shipmentTrackingNumber || ""
    const labelContent = result?.documents?.find((d: any) => d.typeCode === "label")?.content || ""

    return {
      data: {
        tracking_number: trackingNumber,
        carrier: "dhl-express",
        shipment_id: trackingNumber,
        ...result,
      },
      labels: trackingNumber
        ? [
            {
              tracking_number: trackingNumber,
              tracking_url: "https://www.dhl.com/en/express/tracking.html?AWB=" + trackingNumber,
              label_url: labelContent ? `data:application/pdf;base64,${labelContent}` : "",
            },
          ]
        : [],
    }
  }

  async cancelFulfillment(fulfillment: Record<string, any>): Promise<any> {
    this.logger.info(`DHL cancellation requested for ${fulfillment.data?.tracking_number}`)
    return {}
  }

  async createReturnFulfillment(fulfillment: Record<string, any>): Promise<CreateFulfillmentResult> {
    return { data: { carrier: "dhl-express", type: "return" }, labels: [] }
  }

  /** Cart items carry variant weight (grams) → billable weight in kg. */
  private weightInKg(items: any[]): number {
    let grams = 0
    for (const item of items) {
      grams += (item.variant?.weight || 500) * (item.quantity || 1)
    }
    return Math.max(MIN_WEIGHT_KG, grams / 1000)
  }

  /** Fulfillment items lack variant data — resolve weight via order line items. */
  private weightInKgFromFulfillment(items: any[], orderItemById: Map<string, any>): number {
    let grams = 0
    let any = false
    for (const item of items) {
      const qty = Number(item?.quantity) || 1
      const orderItem = item?.line_item_id ? orderItemById.get(item.line_item_id) : undefined
      const w = orderItem?.variant?.weight
      if (w) {
        any = true
        grams += w * qty
      } else {
        grams += 500 * qty
      }
    }
    if (!any && !items.length) grams = 500
    return Math.max(MIN_WEIGHT_KG, grams / 1000)
  }

  private amountOf(value: unknown): number {
    if (typeof value === "number") return Number.isFinite(value) ? value : 0
    if (typeof value === "string") {
      const n = Number(value)
      return Number.isFinite(n) ? n : 0
    }
    if (value && typeof value === "object") {
      const raw = (value as any).value ?? (value as any).numeric
      if (raw !== undefined) return this.amountOf(raw)
    }
    return 0
  }
}

export default DHLExpressFulfillmentService