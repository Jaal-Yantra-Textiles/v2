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
import { ShipglobalClient, ShipglobalOptions } from "./client"
import { CreateShipmentInput, ShipmentItem } from "../provider-interface"
import {
  FlatFallbackConfig,
  resolveFlatFallbackAmount,
} from "../shiprocket/flat-fallback"

type InjectedDeps = { logger: Logger }

/**
 * ShipGlobal fulfillment provider (#shipglobal).
 *
 * Registered as a Medusa fulfillment provider alongside Shiprocket / Delhivery.
 * ShipGlobal is a cross-border courier (India → international), so the only
 * fulfillment option is international. The heavy lifting lives in
 * `ShipglobalClient`, which also implements our normalized
 * `ShippingProviderClient` so the carrier-keyed resolver can drive it directly.
 * This service is the Medusa-fulfilment-flow entry point.
 */
class ShipglobalFulfillmentService extends AbstractFulfillmentProviderService {
  static identifier = "shipglobal"

  protected client: ShipglobalClient
  protected logger: Logger
  /** What an unquotable lane costs. See `shiprocket/flat-fallback.ts`. */
  protected fallbackConfig: FlatFallbackConfig

  constructor(
    { logger }: InjectedDeps,
    options: ShipglobalOptions & FlatFallbackConfig
  ) {
    super()
    this.logger = logger
    this.client = new ShipglobalClient(options)
    this.fallbackConfig = {
      flat_fallback_amounts: options?.flat_fallback_amounts,
      flat_fallback_amount: options?.flat_fallback_amount,
    }
  }

  async getFulfillmentOptions(): Promise<FulfillmentOption[]> {
    return [
      {
        id: "shipglobal-international",
        name: "ShipGlobal International",
        is_return: false,
      },
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

  /**
   * Price the cart's international lane. ShipGlobal quotes by destination
   * country + postcode + weight; an underivable lane, a carrier error, or a
   * refusal (empty rate) resolves to the flat fallback rather than throwing or
   * answering 0 (see `shiprocket/flat-fallback.ts` for why).
   */
  async calculatePrice(
    optionData: Record<string, unknown>,
    _data: Record<string, unknown>,
    context: any
  ): Promise<CalculatedShippingOptionPrice> {
    const to = context?.shipping_address
    const destinationCountry = String(to?.country_code || "").toUpperCase()
    const currencyCode =
      context?.currency_code ?? context?.cart?.currency_code ?? null

    let weightGrams = 0
    for (const item of context?.items ?? []) {
      weightGrams += (item.variant?.weight || 500) * (item.quantity || 1)
    }

    try {
      const rates = await this.client.getRates({
        origin_pincode: "",
        destination_pincode: to?.postal_code || "",
        destination_country: destinationCountry,
        weight_grams: weightGrams || 500,
      })
      const recommended = rates[0]
      if (!recommended || !Number.isFinite(Number(recommended.amount))) {
        return this.flatFallback(
          destinationCountry,
          `ShipGlobal returned no rate to ${to?.postal_code || ""} ${destinationCountry}`,
          optionData,
          currencyCode
        )
      }
      return {
        calculated_amount: Number(recommended.amount),
        is_calculated_price_tax_inclusive: true,
      }
    } catch (e: any) {
      this.logger.error(`ShipGlobal calculatePrice error: ${e.message}`)
      return this.flatFallback(
        destinationCountry,
        e.message,
        optionData,
        currencyCode
      )
    }
  }

  private flatFallback(
    destinationCountry: string,
    reason: string,
    optionData?: Record<string, unknown>,
    currencyCode?: string | null
  ): CalculatedShippingOptionPrice {
    const { amount, reason: unconfigured } = resolveFlatFallbackAmount(
      this.fallbackConfig,
      destinationCountry,
      optionData,
      currencyCode
    )
    this.logger.warn(
      `[shipglobal] falling back to the flat rate ${amount} ${
        currencyCode ? String(currencyCode).toUpperCase() : "(currency unknown)"
      } for ${destinationCountry || "IN"} — ${reason}${
        unconfigured ? ` (${unconfigured})` : ""
      }`
    )
    return {
      calculated_amount: amount!,
      is_calculated_price_tax_inclusive: false,
    }
  }

  async createFulfillment(
    data: Record<string, unknown>,
    items: Partial<Omit<FulfillmentItemDTO, "fulfillment">>[],
    order: Partial<FulfillmentOrderDTO> | undefined,
    fulfillment: Partial<Omit<FulfillmentDTO, "provider_id" | "data" | "items">>
  ): Promise<CreateFulfillmentResult> {
    const shippingAddress = (order as any)?.shipping_address || {}
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
        hsn: oi?.variant?.hs_code || oi?.variant?.metadata?.hs_code || undefined,
      })
    }

    if (!hasWeight) {
      const totalQty = shipItems.reduce((s, i) => s + i.quantity, 0)
      totalWeight = Math.max(400, totalQty * 400)
      if (!maxLength) maxLength = 30
      if (!maxWidth) maxWidth = 25
      if (!maxHeight) maxHeight = Math.max(3, totalQty * 2)
    }

    const input: CreateShipmentInput = {
      reference_id: (order as any)?.id || fulfillment.id || "",
      payment_mode: "prepaid",
      pickup_location_name: "",
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
        country: shippingAddress.country_code || "",
      },
      items: shipItems,
      weight_grams: totalWeight,
      dimensions_cm: { length: maxLength, width: maxWidth, height: maxHeight },
      currency: (order as any)?.currency_code || "USD",
    }

    try {
      const result = await this.client.createShipment(input)
      this.logger.info(`ShipGlobal shipment created: awb=${result.awb}`)
      return {
        data: {
          carrier: "shipglobal",
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
      this.logger.error(`ShipGlobal createFulfillment error: ${e.message}`)
      throw e
    }
  }

  async cancelFulfillment(fulfillment: Record<string, any>): Promise<any> {
    const waybill = fulfillment.data?.waybill || fulfillment.data?.tracking_number
    if (!waybill) return {}
    try {
      return await this.client.cancelShipment({
        awb: waybill,
        provider_refs: { tracking: waybill },
      })
    } catch (e: any) {
      this.logger.error(`ShipGlobal cancelFulfillment error: ${e.message}`)
      throw e
    }
  }

  async createReturnFulfillment(
    _fulfillment: Record<string, any>
  ): Promise<CreateFulfillmentResult> {
    // ShipGlobal has no first-class return API op; a return is a fresh outbound
    // shipment (createFulfillment again). Stub mirrors the other providers.
    return { data: { carrier: "shipglobal", type: "return" }, labels: [] }
  }

  /** The label ShipGlobal produced at create/pay time. Prefer stored data, else
   *  fetch fresh by tracking number. */
  async getFulfillmentDocuments(data: Record<string, any>): Promise<any> {
    const waybill = data?.waybill || data?.tracking_number
    if (!waybill) return []
    try {
      const label = await this.client.getLabel({
        awb: waybill,
        provider_refs: { tracking: waybill },
      })
      if (!label.label_url && !label.data) return []
      return [
        {
          name: "ShipGlobal label",
          typeCode: "label",
          contentType: label.format || "pdf",
          content: label.data || "",
          url: label.label_url || "",
        },
      ]
    } catch (e: any) {
      this.logger.warn(`ShipGlobal document retrieval failed for ${waybill}: ${e.message}`)
      return []
    }
  }
}

export default ShipglobalFulfillmentService