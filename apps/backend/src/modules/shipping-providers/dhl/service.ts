import { AbstractFulfillmentProviderService } from "@medusajs/framework/utils"
import {
  CreateFulfillmentResult,
  FulfillmentOption,
  FulfillmentItemDTO,
  FulfillmentOrderDTO,
  FulfillmentDTO,
  CalculatedShippingOptionPrice,
  CalculateShippingOptionPriceDTO,
  CreateShippingOptionDTO,
  Logger,
} from "@medusajs/framework/types"
import { DHLClient, DHLOptions, normalizeDhlDocuments } from "./client"
import { declaredValueForShipment } from "../delhivery/declared-value"
import { FlatFallbackConfig, resolveFlatFallbackAmount } from "../shiprocket/flat-fallback"

type InjectedDeps = { logger: Logger }

/** Textile fallback when a variant carries no HS code (HS 6304.92 — cotton furnishings). */
const DEFAULT_HS_CODE = "6304.92"

/** DHL bills international shipments at a 0.5 kg minimum. */
const MIN_WEIGHT_KG = 0.5

function hsCodeFor(orderItem: any): string {
  const metadata = orderItem?.variant?.metadata || orderItem?.metadata || {}
  return metadata.hs_code || metadata.hsCode || metadata.HSCode || DEFAULT_HS_CODE
}

/**
 * Map a Medusa document type onto DHL's "Get Image" `typeCode` enum
 * (`waybill`, `commercial-invoice`, `customs-entry`,
 * `transport-accompanying-document`, `generic-entry-summary`,
 * `dhl-issued-proforma-invoice`). Unknown types default to `waybill` (the label),
 * which is the one document every shipment has.
 */
export function dhlDocumentTypeCode(documentType?: string): string {
  const t = String(documentType || "").toLowerCase()
  if (/proforma/.test(t)) return "dhl-issued-proforma-invoice"
  if (/(invoice|commercial)/.test(t)) return "commercial-invoice"
  if (/(label|waybill)/.test(t)) return "waybill"
  if (/customs/.test(t)) return "customs-entry"
  if (/transport/.test(t)) return "transport-accompanying-document"
  if (/summary/.test(t)) return "generic-entry-summary"
  return "waybill"
}

/**
 * DHL's "Get Image" needs the pickup month (`YYYY-MM`) to locate a document.
 * Read it from the fulfillment's timestamps, best-effort; the caller falls back
 * to the current month when none is available (a wrong month is a 404, caught
 * upstream — never a throw).
 */
export function dhlPickupYearMonth(value?: unknown): string | undefined {
  if (value === null || value === undefined || value === "") return undefined
  const d = value instanceof Date ? value : new Date(value as any)
  if (Number.isNaN(d.getTime())) return undefined
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`
}

class DHLExpressFulfillmentService extends AbstractFulfillmentProviderService {
  static identifier = "dhl-express"

  protected client: DHLClient
  protected logger: Logger
  /** What an unquotable lane costs. See `shiprocket/flat-fallback.ts`. */
  protected fallbackConfig: FlatFallbackConfig

  constructor({ logger }: InjectedDeps, options: DHLOptions & FlatFallbackConfig) {
    super()
    this.logger = logger
    this.client = new DHLClient(options)
    this.fallbackConfig = {
      flat_fallback_amounts: options?.flat_fallback_amounts,
      flat_fallback_amount: options?.flat_fallback_amount,
    }
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

  /**
   * Calculated price for a DHL shipping option (`price_type: "calculated"`).
   *
   * Follows the Medusa fulfillment-provider contract:
   * - `optionData` is the shipping option's `data` — the fulfillment option
   *   chosen in the admin, which carries `product_code` from
   *   `getFulfillmentOptions`.
   * - `data` is the shipping method's `data` — validated by
   *   `validateFulfillmentData` (plus any custom frontend data).
   * - `context` carries the cart: `shipping_address`, `items`, and
   *   `from_location` (the stock location shipping the items).
   *
   * Price is resolved through DHL's `/rates` endpoint for the matched
   * product, billing the customer-billed currency (`BILLC`). A lane DHL will
   * not quote — an empty product list, no matched product, no `BILLC` price,
   * or a carrier/network error — resolves to the flat fallback rather than
   * throwing or answering `0` (see `shiprocket/flat-fallback.ts` for why a
   * silent zero is the bug, and why a throw here is worse than what it
   * replaced: it would take the whole shipping options listing with it).
   */
  async calculatePrice(
    optionData: CalculateShippingOptionPriceDTO["optionData"],
    data: CalculateShippingOptionPriceDTO["data"],
    context: CalculateShippingOptionPriceDTO["context"]
  ): Promise<CalculatedShippingOptionPrice> {
    const from = context.from_location?.address
    const to = context.shipping_address
    const items = context.items ?? []
    const destinationCountry = String(to?.country_code || "").toUpperCase()
    /**
     * 🔑 `calculated_amount` is denominated in the CART's currency, so the
     * currency decides whether a fallback figure means anything at all. Read
     * best-effort; when absent the resolver skips its per-currency map rather
     * than guessing between €35 and ₹3200.
     */
    const currencyCode =
      (context as any)?.currency_code ?? (context as any)?.cart?.currency_code ?? null

    try {
      const totalWeightKg = this.weightInKg(items as any[])

      const result = await this.client.getRates({
        origin_country: from?.country_code || "IN",
        origin_city: from?.city || "",
        origin_postal_code: from?.postal_code || "",
        dest_country: to?.country_code || "",
        dest_city: to?.city || "",
        dest_postal_code: to?.postal_code || "",
        weight: totalWeightKg,
        is_customs_declarable: from?.country_code !== to?.country_code,
      })

      const products = result?.products || []
      const productCode = (optionData as any).product_code
      const match =
        products.find((p: any) => p.productCode === productCode) || products[0]

      const billc = (match?.totalPrice || []).find(
        (p: any) => p.currencyType === "BILLC"
      )
      const amount = billc?.price ?? match?.totalPrice?.[0]?.price

      if (!Number.isFinite(Number(amount))) {
        return this.flatFallback(
          destinationCountry,
          `DHL returned no rate for ${productCode || "any product"} to ${to?.city || ""} ${to?.postal_code || ""} ${to?.country_code || ""}`,
          optionData,
          currencyCode
        )
      }

      return { calculated_amount: Number(amount), is_calculated_price_tax_inclusive: true }
    } catch (e: any) {
      this.logger.error(`DHL calculatePrice error: ${e.message}`)
      return this.flatFallback(destinationCountry, e.message, optionData, currencyCode)
    }
  }

  /**
   * The flat rate for a lane DHL would not quote.
   *
   * The `reason` is logged rather than returned: the buyer must not see a
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

    this.logger.warn(
      `[dhl-express] falling back to the flat rate ${amount} ${
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

  /**
   * Cancel a shipment with DHL Express.
   *
   * Deliberately a no-op: DHL's MyDHLAPI exposes **no programmatic cancel**
   * endpoint. A cancellation is a manual action with DHL customer service (via
   * the shipment's tracking number), so the honest behaviour is to record the
   * request in the log and return — inventing an API call that doesn't exist,
   * or throwing, would break the cancel workflow for nothing. The log line
   * carries the tracking number so an operator chasing a cancel has the
   * reference DHL needs.
   */
  async cancelFulfillment(fulfillment: Record<string, any>): Promise<any> {
    this.logger.info(`DHL cancellation requested for ${fulfillment.data?.tracking_number}; DHL Express has no API cancel — raise with DHL customer service`)
    return {}
  }

  /**
   * Return fulfillment — stubbed.
   *
   * DHL has no first-class "return this shipment" API op: a return is a NEW
   * outbound shipment booked the normal way (the receiver becomes the shipper
   * on a fresh waybill), which is `createFulfillment` again, not a separate
   * method. Until a return flow exists that drives it, this returns the same
   * carrier-marked stub Shiprocket uses, so a return fulfillment can at least
   * be recorded without a carrier call.
   */
  async createReturnFulfillment(fulfillment: Record<string, any>): Promise<CreateFulfillmentResult> {
    return { data: { carrier: "dhl-express", type: "return" }, labels: [] }
  }

  /**
   * Documents for a fulfillment — the label and commercial/customs invoice DHL
   * produced at create time. Prefer what's already stored on the fulfillment
   * (the createShipment response is spread onto `data`); otherwise fetch fresh
   * by tracking number.
   */
  async getFulfillmentDocuments(data: Record<string, any>): Promise<any> {
    const stored = normalizeDhlDocuments(data?.documents)
    if (stored.length) return stored
    return this.retrieveDocuments(data)
  }

  /**
   * Retrieve documents of a specific type for a fulfillment.
   *
   * The base `AbstractFulfillmentProviderService` throws from this method, so
   * overriding it is required, not optional. Maps Medusa's `documentType`
   * ("label", "invoice", …) onto DHL's "Get Image" service (`/shipments/{id}/get-image`)
   * and returns the normalized rows; a carrier/network failure (or a stale pickup
   * month) degrades to `[]` rather than throwing, so a document fetch can't wedge
   * the caller.
   */
  async retrieveDocuments(
    fulfillmentData: Record<string, any>,
    documentType?: string
  ): Promise<any> {
    const trackingNumber =
      fulfillmentData?.tracking_number ||
      fulfillmentData?.shipment_id ||
      fulfillmentData?.awb_number ||
      ""
    if (!trackingNumber) return []
    try {
      const res = await this.client.getShipmentImage(trackingNumber, {
        typeCode: dhlDocumentTypeCode(documentType),
        pickupYearAndMonth:
          dhlPickupYearMonth(
            fulfillmentData?.shipped_at ??
              fulfillmentData?.pickup_at ??
              fulfillmentData?.created_at
          ) || new Date().toISOString().slice(0, 7),
      })
      return normalizeDhlDocuments(res)
    } catch (e: any) {
      this.logger.warn(`DHL document retrieval failed for ${trackingNumber}: ${e.message}`)
      return []
    }
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