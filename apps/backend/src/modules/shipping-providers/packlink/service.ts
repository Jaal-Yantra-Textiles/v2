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
   * 🔑 Where the API key actually lives.
   *
   * Not SSM and not an env var: the key is stored on a `socials` platform
   * record of category "shipping", exactly like Shiprocket's — so an admin can
   * rotate it in the UI without a redeploy, and each partner can hold their own
   * Packlink account rather than sharing one platform-wide secret.
   *
   * ⚠️ `socials` and `encryption` reach a PROVIDER only because the fulfillment
   * module declares `dependencies: [SOCIALS_MODULE, ENCRYPTION_MODULE]` in BOTH
   * medusa-config.ts and medusa-config.prod.ts — a provider is constructed with
   * the parent module's cradle, which otherwise carries six default keys and
   * nothing else. The Dockerfile copies the prod config OVER the dev one, so a
   * dependency declared in only one of them does not exist in production.
   */
  socials?: any
  encryption?: any
  /**
   * Reaches the provider the same way. Optional: without it a non-EUR cart
   * falls back rather than returning a euro figure wearing a pound sign.
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
  /** Resolved once per process; a platform lookup per rate call would be absurd. */
  protected platformClient: PacklinkClient | null = null
  protected platformLookupDone = false
  /** Origin from the platform record, when it carries one. */
  protected platformOrigin: { country?: string; zip?: string } = {}

  constructor(deps: InjectedDeps, options: PacklinkProviderOptions = {}) {
    super()
    this.deps = deps
    this.logger = deps.logger
    this.options = options
    this.client = new PacklinkClient(options)
  }

  /**
   * The credential-bearing client.
   *
   * Resolved once per process — a platform lookup per rate call would be
   * absurd — and cached even on failure, so a missing record does not mean a
   * database round-trip on every quote.
   *
   * Falls back to the options/env client rather than throwing: a provider that
   * cannot read its record should degrade to whatever it was given, and SAY so,
   * because the symptom it otherwise produces (every quote quietly falling back
   * to a flat number) looks identical to a carrier not serving the lane.
   */
  protected async resolveClient(): Promise<PacklinkClient> {
    if (this.platformLookupDone) {
      return this.platformClient ?? this.client
    }
    this.platformLookupDone = true

    const socials = this.deps?.socials
    if (!socials) {
      this.logger?.warn?.(
        "[packlink] no `socials` in the provider cradle — falling back to the configured api_key. " +
          "Check `dependencies` on the fulfillment module in BOTH medusa-config files."
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
        return type === "packlink" || type.includes("packlink")
      })

      const cfg = (match?.api_config as Record<string, any>) || {}
      const apiKey = await this.readSecret(cfg, "api_key")

      if (!apiKey) {
        this.logger?.warn?.(
          `[packlink] shipping platform record ${
            match ? "found but carries no api_key" : "not found"
          } — falling back to the configured api_key.`
        )
        return this.client
      }

      this.platformClient = new PacklinkClient({
        ...this.options,
        api_key: apiKey,
        base_url:
          (typeof cfg.base_url === "string" && cfg.base_url) ||
          this.options.base_url,
        source:
          (typeof cfg.source === "string" && cfg.source) || this.options.source,
      })
      // The origin travels with the credential: a partner's Packlink account
      // ships from THEIR address, not the platform's.
      this.platformOrigin = {
        country:
          (typeof cfg.origin_country === "string" && cfg.origin_country) ||
          undefined,
        zip:
          (typeof cfg.origin_zip === "string" && cfg.origin_zip) || undefined,
      }
      this.logger?.info?.(
        "[packlink] credentials resolved from the shipping platform record."
      )
      return this.platformClient
    } catch (e: any) {
      this.logger?.warn?.(
        `[packlink] could not read the shipping platform record: ${
          e?.message ?? e
        } — falling back to the configured api_key.`
      )
      return this.client
    }
  }

  /** Decrypt a secret field if the encryption module is present, else read it plain. */
  protected async readSecret(
    cfg: Record<string, any>,
    field: string
  ): Promise<string | undefined> {
    // Mirrors Shiprocket's `readSecret` and `resolveShippingProvider`'s exactly
    // — same key names, same precedence. A second convention here would create
    // an affordance nothing writes.
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

    try {
      // Resolve BEFORE reading the origin: the platform record carries the
      // partner's own pickup address alongside their key.
      const client = await this.resolveClient()
      const fromCountry = String(
        this.platformOrigin.country ?? opts.origin_country ?? ""
      )
      const fromZip = String(this.platformOrigin.zip ?? opts.origin_zip ?? "")

      if (!toCountry || !fromCountry) {
        return this.fallback(
          currency,
          "no origin/destination country on the quote"
        )
      }

      const services = await client.getServices({
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
