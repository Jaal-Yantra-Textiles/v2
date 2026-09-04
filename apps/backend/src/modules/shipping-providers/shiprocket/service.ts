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
import { resolveShipmentPaymentMode } from "./payment-mode"
import { FlatFallbackConfig, resolveFlatFallbackAmount } from "./flat-fallback"

/**
 * 🔴 `socials` and `encryption` reach the provider ONLY because the fulfillment
 * module declares `dependencies: [SOCIALS_MODULE, ENCRYPTION_MODULE]` in
 * `medusa-config{,.prod}.ts`. A provider is constructed with the parent
 * module's cradle, which otherwise carries six default keys and nothing else.
 *
 * Optional on purpose: if the declaration is ever dropped, this degrades to the
 * env-configured client rather than throwing — but it says so loudly, because
 * the failure it replaces was completely silent.
 */
type InjectedDeps = {
  logger: Logger
  socials?: any
  encryption?: any
}

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
  protected deps: InjectedDeps
  protected options: ShiprocketOptions & FlatFallbackConfig
  /** Resolved once per process; a login per rate call would be absurd. */
  protected platformClient: ShiprocketClient | null = null
  protected platformLookupDone = false
  /** What an unquotable lane costs. See `flat-fallback.ts`. */
  protected fallbackConfig: FlatFallbackConfig

  constructor(
    deps: InjectedDeps,
    options: ShiprocketOptions & FlatFallbackConfig
  ) {
    super()
    const { logger } = deps
    this.logger = logger
    this.deps = deps
    this.options = options
    this.client = new ShiprocketClient(options)
    this.fallbackConfig = {
      flat_fallback_amounts: options?.flat_fallback_amounts,
      flat_fallback_amount: options?.flat_fallback_amount,
    }
  }


  /**
   * The client that can actually authenticate.
   *
   * 🔴 This is the whole fix. `calculatePrice` used the client built from
   * MODULE OPTIONS — i.e. env — and `SHIPROCKET_PASSWORD` is deliberately unset
   * in both `.env` and the copilot manifest, because the credentials live in
   * the `category:shipping` SocialPlatform record that `resolveShippingProvider`
   * reads for label/pickup/track. So the carrier worked everywhere EXCEPT
   * rating, which posted `password: undefined` and got
   * `422 — password: The password is required` on every live rate call.
   *
   * Two credential paths, and the money-facing one was reading the blank half.
   * This reads the same record the rest of the carrier does.
   *
   * Cached per process: a login round-trip per rate call would be absurd, and
   * the record does not change between deploys.
   */
  protected async resolveClient(): Promise<ShiprocketClient> {
    if (this.platformLookupDone) {
      return this.platformClient ?? this.client
    }
    this.platformLookupDone = true

    const socials = this.deps?.socials
    if (!socials) {
      // Loud on purpose: this branch means the `dependencies` declaration on
      // the fulfillment module was dropped, and the symptom it causes (rates
      // silently failing auth) is otherwise invisible.
      this.logger?.warn?.(
        "[shiprocket] no `socials` in the provider cradle — falling back to env credentials. " +
          "Rating will fail auth unless SHIPROCKET_PASSWORD is set. Check `dependencies` on the fulfillment module."
      )
      return this.client
    }

    try {
      const platforms = await socials.listSocialPlatforms({
        category: "shipping",
        status: "active",
      })
      const match = (platforms || []).find((p: any) => {
        const cfg = (p.api_config as Record<string, any>) || {}
        const type = String(
          cfg.provider_type || cfg.provider || p.name || ""
        ).toLowerCase()
        return type === "shiprocket" || type.includes("shiprocket")
      })

      const cfg = (match?.api_config as Record<string, any>) || {}
      const email = typeof cfg.email === "string" ? cfg.email : undefined
      const password = await this.readSecret(cfg, "password")

      if (!email || !password) {
        this.logger?.warn?.(
          `[shiprocket] shipping platform record ${
            match ? "found but incomplete" : "not found"
          } — falling back to env credentials for rating.`
        )
        return this.client
      }

      this.platformClient = new ShiprocketClient({
        ...this.options,
        email,
        password,
        pickup_location:
          (typeof cfg.pickup_location === "string" && cfg.pickup_location) ||
          this.options.pickup_location,
      })
      this.logger?.info?.(
        `[shiprocket] rating credentials resolved from the shipping platform record (${email}).`
      )
      return this.platformClient
    } catch (e: any) {
      this.logger?.warn?.(
        `[shiprocket] could not read the shipping platform record: ${
          e?.message ?? e
        } — falling back to env credentials.`
      )
      return this.client
    }
  }

  /** Decrypt a secret field if the encryption module is present, else read it plain. */
  protected async readSecret(
    cfg: Record<string, any>,
    field: string
  ): Promise<string | undefined> {
    // Mirrors `resolveShippingProvider`'s own `readSecret` exactly — same key
    // names, same precedence. Inventing a second key here would create an
    // affordance nothing writes, and the two readers of the same record must
    // not disagree about where the secret lives.
    const encrypted = cfg?.[`${field}_encrypted`]
    if (encrypted && this.deps?.encryption?.decrypt) {
      try {
        const plain = await this.deps.encryption.decrypt(encrypted)
        if (typeof plain === "string" && plain.length) return plain
      } catch {
        /* fall through to plaintext */
      }
    }
    const plain = cfg?.[field]
    return typeof plain === "string" && plain.length ? plain : undefined
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
      // The credential-bearing client, not the env-built one — see
      // `resolveClient`. This single line is what was answering 422.
      const rateClient = await this.resolveClient()
      const rates = await rateClient.getRates({
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
    const subTotal = shipItems.reduce((s, i) => s + i.unit_price * i.quantity, 0)

    // The rule lives in `payment-mode.ts`, pure and unit-tested — an
    // international lane has no COD product, so deriving this inline is how it
    // silently became "no shipment at all". See that file's header.
    const paymentMode = resolveShipmentPaymentMode({
      payment_status: paymentStatus,
      destination_country_code: shippingAddress?.country_code,
      sub_total: subTotal,
    })

    if (paymentMode.warn_uncaptured) {
      this.logger.warn(
        `[shiprocket] order ${(order as any)?.id} ships to ` +
          `${String(shippingAddress?.country_code || "").toUpperCase()} with ` +
          `payment_status="${paymentStatus}". Sent as PREPAID because Shiprocket has ` +
          `no international COD — the payment is not confirmed captured.`
      )
    }

    const input: CreateShipmentInput = {
      reference_id: (order as any)?.id || fulfillment.id || "",
      payment_mode: paymentMode.payment_mode,
      cod_amount: paymentMode.cod_amount,
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
