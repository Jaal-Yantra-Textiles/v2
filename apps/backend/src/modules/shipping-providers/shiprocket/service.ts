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
import { deriveShiprocketRateContext } from "./rate-context"
import { FlatFallbackConfig, resolveFlatFallbackAmount } from "./flat-fallback"

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
  /** What an unquotable lane costs. See `flat-fallback.ts`. */
  protected fallbackConfig: FlatFallbackConfig

  constructor(
    { logger }: InjectedDeps,
    options: ShiprocketOptions & FlatFallbackConfig
  ) {
    super()
    this.logger = logger
    this.client = new ShiprocketClient(options)
    this.fallbackConfig = {
      flat_fallback_amounts: options?.flat_fallback_amounts,
      flat_fallback_amount: options?.flat_fallback_amount,
    }
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

  /**
   * Price the cart's lane (#1417).
   *
   * Domestic AND international. The derivation lives in `deriveShiprocketRateContext`
   * (pure, unit-tested) and the client already branches on `destination_country`
   * into the `/international/*` endpoint — this method's job is only to ask, and
   * to decide what an unquotable lane costs.
   *
   * 🔴 It no longer answers `0`. Every path that cannot produce a live rate —
   * an underivable lane, a carrier error, an empty courier list — resolves to a
   * flat fallback: the configured one, else a defined non-zero default. It never
   * throws; see `flat-fallback.ts` for why a throw here is worse than what it
   * replaced.
   */
  async calculatePrice(
    optionData: Record<string, unknown>,
    _data: Record<string, unknown>,
    context: any
  ): Promise<CalculatedShippingOptionPrice> {
    const derived = deriveShiprocketRateContext(context)
    const destinationCountry = String(
      context?.shipping_address?.country_code || ""
    ).toUpperCase()
    /**
     * 🔑 `calculated_amount` is denominated in the CART's currency, so the
     * currency is what decides whether a fallback figure means anything at all.
     * Read best-effort and threaded through: when it is absent the resolver
     * skips its per-currency map rather than guessing between €35 and ₹3200.
     */
    const currencyCode =
      context?.currency_code ?? context?.cart?.currency_code ?? null

    if (!derived.context) {
      return this.flatFallback(
        destinationCountry,
        derived.reason!,
        optionData,
        currencyCode
      )
    }

    const rateContext = derived.context

    try {
      const rates = await this.client.getRates({
        origin_pincode: rateContext.origin_pincode,
        destination_pincode: rateContext.destination_pincode,
        destination_country: rateContext.destination_country,
        weight_grams: rateContext.weight_grams,
        dimensions_cm: rateContext.dimensions_cm,
      })

      const recommended = rates.find((r) => r.is_recommended) || rates[0]

      // An EMPTY courier list is a refusal wearing a 200 — it is how the
      // domestic endpoint answers a lane it will not carry. Treating it as a
      // successful quote of 0 is precisely the bug this method used to have, so
      // it falls back like any other failure.
      if (!recommended || !Number.isFinite(Number(recommended.amount))) {
        return this.flatFallback(
          destinationCountry,
          `Shiprocket returned no courier for ${rateContext.origin_pincode} → ${
            rateContext.destination_country || rateContext.destination_pincode
          }`,
          optionData,
          currencyCode
        )
      }

      return {
        calculated_amount: Number(recommended.amount),
        is_calculated_price_tax_inclusive: true,
      }
    } catch (e: any) {
      this.logger.error(`Shiprocket calculatePrice error: ${e.message}`)
      return this.flatFallback(
        destinationCountry,
        e.message,
        optionData,
        currencyCode
      )
    }
  }

  /**
   * The flat rate for a lane the carrier would not quote.
   *
   * The `reason` is logged rather than returned: the buyer must not be shown a
   * carrier's internal complaint, but an operator needs to know the lane fell
   * back rather than quoting live — otherwise a carrier outage looks exactly
   * like normal pricing. 🔑 That log line is the ONLY thing separating this from
   * the silent zero it replaced, so it must never be dropped to reduce noise.
   */
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

    // 🔑 The currency is in the log line because the amount is meaningless
    // without it: "falling back to 200" reads as fine and is €200. That log is
    // the only thing separating a defined fallback from a silent wrong number,
    // so it has to carry enough to spot one.
    this.logger.warn(
      `[shiprocket] falling back to the flat rate ${amount} ${
        currencyCode ? String(currencyCode).toUpperCase() : "(currency unknown)"
      } for ${destinationCountry || "IN"} — ${reason}${
        unconfigured ? ` (${unconfigured})` : ""
      }`
    )

    return {
      calculated_amount: amount!,
      // A flat rate is a figure WE set, so it carries no carrier tax treatment
      // to inherit. Claiming tax-inclusive here would quietly shrink it.
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
