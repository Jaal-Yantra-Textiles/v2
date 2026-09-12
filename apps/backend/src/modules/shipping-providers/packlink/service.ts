import { AbstractFulfillmentProviderService } from "@medusajs/framework/utils"
import {
  CalculatedShippingOptionPrice,
  CreateShippingOptionDTO,
  FulfillmentOption,
  Logger,
} from "@medusajs/framework/types"

import { PacklinkClient, PacklinkOptions } from "./client"
import {
  RateSelectionPolicy,
  applyPolicyToPrice,
  selectService,
  servicePrice,
} from "./rate-select"

/**
 * Packlink fulfillment provider — live rates for partners who ship from EUROPE.
 *
 * ## Why a second carrier module
 *
 * Shiprocket originates in India. EasyPost's account originates only in the
 * US/CA. Le Ciricotte ships from Greve in Chianti, so neither could quote it,
 * and its international shipping was a hand-set flat rate — which the live
 * Packlink rates then showed to be loss-making on 3 of its 4 lanes (to the UAE
 * by €52 per parcel). A calculated provider ends that class of problem: the
 * carrier quotes, nobody guesses.
 *
 * ## What this does NOT do
 *
 * It quotes. It does not book labels. `createFulfillment` throws a named error
 * rather than pretending, because a provider that silently fails to book looks
 * exactly like one that booked and lost the parcel. Booking is the next slice
 * and needs its own credentials and customs handling.
 */
type InjectedDeps = {
  logger: Logger
  /**
   * Reaches the provider only if the fulfillment module declares it in
   * `dependencies` in BOTH medusa-config.ts and medusa-config.prod.ts — the
   * Dockerfile copies the prod config OVER the dev one, so a dependency
   * declared in only one of them does not exist in production.
   *
   * Optional: without it a non-EUR cart falls back rather than returning a euro
   * figure wearing a pound sign.
   */
  fx_rates?: any
}

export type PacklinkProviderOptions = PacklinkOptions &
  RateSelectionPolicy & {
    /** Origin, when the shipping option cannot supply one. */
    origin_country?: string
    origin_zip?: string
    /** Parcel assumed when the cart cannot say. Quotes scale with weight. */
    default_weight_kg?: number
    default_length_cm?: number
    default_width_cm?: number
    default_height_cm?: number
    /** Per-currency figure used when a live quote is impossible. */
    flat_fallback_amounts?: Record<string, number>
  }

/** Packlink prices every service it returned for our lanes in euros. */
export const PACKLINK_RATE_CURRENCY = "EUR"

class PacklinkFulfillmentService extends AbstractFulfillmentProviderService {
  static identifier = "packlink"

  protected client: PacklinkClient
  protected logger: Logger
  protected deps: InjectedDeps
  protected options: PacklinkProviderOptions

  constructor(deps: InjectedDeps, options: PacklinkProviderOptions = {}) {
    super()
    this.deps = deps
    this.logger = deps.logger
    this.options = options
    this.client = new PacklinkClient(options)
  }

  async getFulfillmentOptions(): Promise<FulfillmentOption[]> {
    return [
      { id: "packlink-international", name: "International (Packlink)" },
      {
        id: "packlink-international-return",
        name: "International Return (Packlink)",
        is_return: true,
      },
    ]
  }

  async validateFulfillmentData(
    _optionData: Record<string, unknown>,
    data: Record<string, unknown>
  ): Promise<any> {
    return data
  }

  async validateOption(_data: Record<string, any>): Promise<boolean> {
    return true
  }

  /** Calculated, always — that is the entire point of this provider. */
  async canCalculate(_data: CreateShippingOptionDTO): Promise<boolean> {
    return true
  }

  async calculatePrice(
    optionData: Record<string, unknown>,
    _data: Record<string, unknown>,
    context: any
  ): Promise<CalculatedShippingOptionPrice> {
    const opts = { ...this.options, ...(optionData as PacklinkProviderOptions) }
    const currency = String(
      context?.currency_code ?? context?.cart?.currency_code ?? ""
    ).toUpperCase()

    const toCountry = String(context?.shipping_address?.country_code ?? "")
    const toZip = String(context?.shipping_address?.postal_code ?? "")
    const fromCountry = String(opts.origin_country ?? "")
    const fromZip = String(opts.origin_zip ?? "")

    if (!toCountry || !fromCountry) {
      return this.fallback(currency, "no origin/destination country on the quote")
    }

    try {
      const services = await this.client.getServices({
        from_country: fromCountry,
        from_zip: fromZip,
        to_country: toCountry,
        to_zip: toZip,
        weight_kg: Number(opts.default_weight_kg ?? 1),
        length_cm: Number(opts.default_length_cm ?? 30),
        width_cm: Number(opts.default_width_cm ?? 25),
        height_cm: Number(opts.default_height_cm ?? 10),
      })

      const chosen = selectService(services, opts)
      const raw = chosen ? servicePrice(chosen) : null
      if (raw === null) {
        // 🔑 An EMPTY service list is a refusal wearing a 200. Quoting 0 here
        // would ship the parcel free; this is exactly the bug the Shiprocket
        // provider had to fix.
        return this.fallback(
          currency,
          `Packlink returned no usable service for ${fromCountry}->${toCountry}`
        )
      }

      const priced = applyPolicyToPrice(raw, opts)
      const converted = await this.toCartCurrency(priced, currency)
      if (converted === null) {
        return this.fallback(
          currency,
          `no ${PACKLINK_RATE_CURRENCY}->${currency} rate; refusing to quote a euro figure as ${currency}`
        )
      }

      return { calculated_amount: converted, is_calculated_price_tax_inclusive: false }
    } catch (e: any) {
      return this.fallback(currency, e?.message ?? String(e))
    }
  }

  /**
   * Euros into the cart's currency.
   *
   * Returns `null` rather than the euro figure when it cannot convert. Handing
   * back an unconverted number is how a ₹890 quote once reached an Australian
   * buyer as A$890 — 55× wrong (#rate-currency). A EUR cart needs no
   * conversion and must not be multiplied by a cached 1.0.
   */
  protected async toCartCurrency(
    amount: number,
    currency: string
  ): Promise<number | null> {
    if (!currency) return null
    if (currency === PACKLINK_RATE_CURRENCY) return amount
    const fx = this.deps?.fx_rates
    if (!fx?.convert) return null
    try {
      const out = await fx.convert(amount, PACKLINK_RATE_CURRENCY, currency)
      const n = Number(out)
      return Number.isFinite(n) && n > 0 ? n : null
    } catch {
      return null
    }
  }

  /** A number somebody chose, in the right currency — or a loud refusal. */
  protected fallback(
    currency: string,
    reason: string
  ): CalculatedShippingOptionPrice {
    const map = this.options.flat_fallback_amounts ?? {}
    const amount = map[currency] ?? map[currency?.toLowerCase?.()] ?? null
    this.logger?.warn?.(
      `[packlink] live quote unavailable (${reason}); ${
        amount === null
          ? "and no flat fallback for " + (currency || "(unknown currency)")
          : `using flat fallback ${amount} ${currency}`
      }`
    )
    if (amount === null) {
      throw new Error(
        `Packlink could not quote and has no flat fallback for ${currency || "(unknown currency)"}: ${reason}`
      )
    }
    return { calculated_amount: amount, is_calculated_price_tax_inclusive: false }
  }

  async createFulfillment(): Promise<any> {
    // Named, not silent. See the class docblock.
    throw new Error(
      "Packlink provider quotes rates only; label booking is not implemented. Book through the partner's own Packlink PRO account, or use a provider that implements createFulfillment."
    )
  }

  async cancelFulfillment(): Promise<any> {
    return {}
  }
}

export default PacklinkFulfillmentService
