import {
  AbstractPaymentProvider,
  MedusaError,
} from "@medusajs/framework/utils"
import {
  AuthorizePaymentInput,
  AuthorizePaymentOutput,
  CancelPaymentInput,
  CancelPaymentOutput,
  CapturePaymentInput,
  CapturePaymentOutput,
  DeletePaymentInput,
  DeletePaymentOutput,
  GetPaymentStatusInput,
  GetPaymentStatusOutput,
  InitiatePaymentInput,
  InitiatePaymentOutput,
  Logger,
  RefundPaymentInput,
  RefundPaymentOutput,
  RetrievePaymentInput,
  RetrievePaymentOutput,
  UpdatePaymentInput,
  UpdatePaymentOutput,
  WebhookActionResult,
} from "@medusajs/framework/types"
import {
  computeApplicationFee,
  mapStripeStatus,
  parseFeePercent,
  toStripeMinorUnits,
} from "./lib/fee"

type StripeConnectOptions = {
  // Platform Stripe secret (JYT's own account) — owns the connected accounts.
  apiKey: string
  // Fallback fee fraction when a partner's plan can't be resolved (e.g. 0.02).
  // Default 0 (charge no platform fee rather than over-charging).
  defaultFeePercent?: number
  // Refund the platform application fee back to the customer on refunds
  // (direct-charge semantics). Default true — partner isn't out-of-pocket.
  refundApplicationFee?: boolean
  // If a store has NO active connected account, charge on the platform account
  // with no application fee instead of failing. Default false → throw, so we
  // never silently collect a partner sale into the platform account.
  allowPlatformFallback?: boolean
}

// partner_payment_config.provider_id under which Half A stores the Connect
// account — NOT this payment provider's own id.
const CONNECT_CONFIG_PROVIDER_ID = "pp_stripe_stripe"

type ResolvedConnect = {
  connectAccountId: string
  partnerId: string
}

/**
 * Storefront payment provider that routes a partner's checkout INTO their
 * Stripe Connect (Standard) account via **direct charges** with an
 * application_fee_amount to the platform. Mirrors the per-partner resolution
 * pattern already proven by the PayU provider (cart → sales_channel → store →
 * partner → partner_payment_config).
 */
class StripeConnectPaymentProviderService extends AbstractPaymentProvider<StripeConnectOptions> {
  static identifier = "stripe-connect"

  protected logger_: Logger
  protected options_: StripeConnectOptions
  protected container_: any
  private stripe_: any

  constructor(container: { logger: Logger }, options: StripeConnectOptions) {
    super(container as any, options)
    this.logger_ = container.logger
    this.options_ = options
    this.container_ = container
  }

  static validateOptions(options: Record<any, any>): void {
    if (!options.apiKey) {
      throw new Error("Stripe Connect provider requires `apiKey` (platform secret)")
    }
  }

  private async getStripe(): Promise<any> {
    if (!this.stripe_) {
      const Stripe = await import("stripe").then((m) => m.default)
      this.stripe_ = new Stripe(this.options_.apiKey)
    }
    return this.stripe_
  }

  /** Stripe request options that scope a call to the connected account. */
  private accountOpts(accountId?: string | null): Record<string, any> {
    return accountId ? { stripeAccount: accountId } : {}
  }

  /**
   * Resolve the partner's ACTIVE connected account from the cart context.
   * cart.sales_channel_id → store → partner → partner_payment_config. Returns
   * null when the partner has no charge-enabled Connect account.
   */
  private async resolveConnect(
    context?: Record<string, unknown>
  ): Promise<ResolvedConnect | null> {
    if (!context) return null
    try {
      const salesChannelId =
        (context as any)?.extra?.sales_channel_id ||
        (context as any)?.sales_channel_id
      if (!salesChannelId) return null

      const query = this.container_.resolve?.("query")
      if (!query) return null

      const { data: stores } = await query
        .graph({
          entity: "store",
          filters: { default_sales_channel_id: salesChannelId },
          fields: ["id", "partner.*"],
        })
        .catch(() => ({ data: [] }))

      const partnerId = stores?.[0]?.partner?.id
      if (!partnerId) return null

      const configService = this.container_.resolve?.("partner_payment_config")
      if (!configService) return null

      const configs = await configService.listPartnerPaymentConfigs({
        partner_id: partnerId,
        provider_id: CONNECT_CONFIG_PROVIDER_ID,
        is_active: true,
      })
      const config = configs?.[0]
      if (
        !config?.connect_account_id ||
        !config?.connect_charges_enabled // "Connect wins when active"
      ) {
        return null
      }

      return { connectAccountId: config.connect_account_id, partnerId }
    } catch (e: any) {
      this.logger_.warn(
        `[stripe-connect] failed to resolve connected account: ${e?.message}`
      )
      return null
    }
  }

  /**
   * Application fee fraction from the partner's active plan
   * (partner_subscription → plan.features.payment_processing_fee). Falls back
   * to options.defaultFeePercent (default 0).
   */
  private async resolveFeePercent(partnerId: string): Promise<number> {
    const fallback = this.options_.defaultFeePercent ?? 0
    try {
      const query = this.container_.resolve?.("query")
      if (!query) return fallback
      const { data: subs } = await query
        .graph({
          entity: "partner_subscription",
          filters: { partner_id: partnerId, status: "active" },
          fields: ["id", "plan.features"],
        })
        .catch(() => ({ data: [] }))
      const feeRaw = subs?.[0]?.plan?.features?.payment_processing_fee
      if (feeRaw == null) return fallback
      const pct = parseFeePercent(feeRaw)
      return pct > 0 ? pct : fallback
    } catch {
      return fallback
    }
  }

  async initiatePayment(
    input: InitiatePaymentInput
  ): Promise<InitiatePaymentOutput> {
    const { amount, currency_code, context, data } = input
    const stripe = await this.getStripe()
    const minor = toStripeMinorUnits(Number(amount), currency_code)
    const sessionId = (data?.session_id as string) || ""
    const email =
      (context as any)?.email || (context?.customer as any)?.email || undefined

    const resolved = await this.resolveConnect(context)

    if (resolved) {
      const pct = await this.resolveFeePercent(resolved.partnerId)
      const fee = computeApplicationFee(minor, pct)

      const intent = await stripe.paymentIntents.create(
        {
          amount: minor,
          currency: currency_code.toLowerCase(),
          automatic_payment_methods: { enabled: true },
          ...(fee > 0 ? { application_fee_amount: fee } : {}),
          ...(email ? { receipt_email: email } : {}),
          metadata: {
            partner_id: resolved.partnerId,
            session_id: sessionId,
            platform: "jyt",
          },
        },
        this.accountOpts(resolved.connectAccountId)
      )

      this.logger_.info(
        `[stripe-connect] direct charge on ${resolved.connectAccountId} ` +
          `amount=${minor}${currency_code} fee=${fee} (partner=${resolved.partnerId})`
      )

      return {
        id: intent.id,
        data: {
          id: intent.id,
          client_secret: intent.client_secret,
          connect_account_id: resolved.connectAccountId,
          partner_id: resolved.partnerId,
          application_fee_amount: fee,
          amount: minor,
          currency: currency_code.toLowerCase(),
          connected: true,
        },
      }
    }

    // No active connected account for this store.
    if (!this.options_.allowPlatformFallback) {
      throw new MedusaError(
        MedusaError.Types.NOT_ALLOWED,
        "This store has no active Stripe Connect account. The partner must finish Stripe onboarding before accepting payments."
      )
    }

    const intent = await stripe.paymentIntents.create({
      amount: minor,
      currency: currency_code.toLowerCase(),
      automatic_payment_methods: { enabled: true },
      ...(email ? { receipt_email: email } : {}),
      metadata: { session_id: sessionId, platform: "jyt", connected: "false" },
    })
    this.logger_.info(
      `[stripe-connect] platform fallback charge amount=${minor}${currency_code} (no connected account)`
    )
    return {
      id: intent.id,
      data: {
        id: intent.id,
        client_secret: intent.client_secret,
        connect_account_id: null,
        application_fee_amount: 0,
        amount: minor,
        currency: currency_code.toLowerCase(),
        connected: false,
      },
    }
  }

  private async retrieveIntent(data?: Record<string, unknown>): Promise<any> {
    const stripe = await this.getStripe()
    const id = (data?.id as string) || (data?.payment_intent_id as string)
    if (!id) throw new MedusaError(MedusaError.Types.INVALID_DATA, "Missing payment intent id")
    return stripe.paymentIntents.retrieve(
      id,
      this.accountOpts(data?.connect_account_id as string)
    )
  }

  async authorizePayment(
    input: AuthorizePaymentInput
  ): Promise<AuthorizePaymentOutput> {
    const intent = await this.retrieveIntent(input.data)
    const status = mapStripeStatus(intent.status, !!intent.last_payment_error)
    return { status, data: { ...input.data, status: intent.status } }
  }

  async getPaymentStatus(
    input: GetPaymentStatusInput
  ): Promise<GetPaymentStatusOutput> {
    const intent = await this.retrieveIntent(input.data)
    return {
      status: mapStripeStatus(intent.status, !!intent.last_payment_error),
      data: { ...input.data, status: intent.status },
    }
  }

  async capturePayment(
    input: CapturePaymentInput
  ): Promise<CapturePaymentOutput> {
    const stripe = await this.getStripe()
    const id = input.data?.id as string
    try {
      const intent = await stripe.paymentIntents.capture(
        id,
        {},
        this.accountOpts(input.data?.connect_account_id as string)
      )
      return { data: { ...input.data, status: intent.status } }
    } catch (e: any) {
      // Already captured (auto-capture) → treat as success.
      if (e?.code === "payment_intent_unexpected_state") {
        return { data: { ...input.data } }
      }
      throw e
    }
  }

  async refundPayment(input: RefundPaymentInput): Promise<RefundPaymentOutput> {
    const stripe = await this.getStripe()
    const id = input.data?.id as string
    const currency = (input.data?.currency as string) || "eur"
    const refundApplicationFee = this.options_.refundApplicationFee ?? true

    const refund = await stripe.refunds.create(
      {
        payment_intent: id,
        amount: toStripeMinorUnits(Number(input.amount), currency),
        // Direct-charge refund: also hand back the platform fee so the partner
        // isn't out-of-pocket for it.
        ...(refundApplicationFee ? { refund_application_fee: true } : {}),
      },
      this.accountOpts(input.data?.connect_account_id as string)
    )
    return {
      data: { ...input.data, refund_id: refund.id, refunded: true },
    }
  }

  async cancelPayment(input: CancelPaymentInput): Promise<CancelPaymentOutput> {
    const stripe = await this.getStripe()
    const id = input.data?.id as string
    try {
      if (id) {
        await stripe.paymentIntents.cancel(
          id,
          undefined,
          this.accountOpts(input.data?.connect_account_id as string)
        )
      }
    } catch (e: any) {
      this.logger_.warn(`[stripe-connect] cancel failed: ${e?.message}`)
    }
    return { data: { ...input.data, status: "canceled" } }
  }

  async deletePayment(input: DeletePaymentInput): Promise<DeletePaymentOutput> {
    return this.cancelPayment(input as any)
  }

  async retrievePayment(
    input: RetrievePaymentInput
  ): Promise<RetrievePaymentOutput> {
    try {
      const intent = await this.retrieveIntent(input.data)
      return { data: { ...input.data, status: intent.status } }
    } catch {
      return { data: input.data }
    }
  }

  async updatePayment(input: UpdatePaymentInput): Promise<UpdatePaymentOutput> {
    const { amount, currency_code, data } = input
    const id = data?.id as string
    if (!id || amount == null) return { data: { ...data } }

    const stripe = await this.getStripe()
    const minor = toStripeMinorUnits(Number(amount), currency_code)
    const connectAccountId = data?.connect_account_id as string

    // Recompute the application fee for the new amount (direct charges allow
    // updating application_fee_amount pre-capture).
    let fee = (data?.application_fee_amount as number) ?? 0
    if (connectAccountId && data?.partner_id) {
      const pct = await this.resolveFeePercent(data.partner_id as string)
      fee = computeApplicationFee(minor, pct)
    }

    try {
      await stripe.paymentIntents.update(
        id,
        {
          amount: minor,
          ...(connectAccountId && fee > 0
            ? { application_fee_amount: fee }
            : {}),
        },
        this.accountOpts(connectAccountId)
      )
    } catch (e: any) {
      this.logger_.warn(`[stripe-connect] update failed: ${e?.message}`)
    }
    return {
      data: { ...data, amount: minor, application_fee_amount: fee },
    }
  }

  /**
   * Payment events for direct charges are delivered to the platform's Connect
   * webhook endpoint. Wiring that route to dispatch here is a follow-up; this
   * maps a already-parsed payment_intent event so it works once wired.
   */
  async getWebhookActionAndData(payload: {
    data: Record<string, unknown>
    rawData: string | Buffer
    headers: Record<string, unknown>
  }): Promise<WebhookActionResult> {
    const event = payload.data as any
    const type = event?.type as string
    const intent = event?.data?.object || event?.object || {}
    const sessionId = intent?.metadata?.session_id

    if (!sessionId) return { action: "not_supported" }

    const amount = intent?.amount
    switch (type) {
      case "payment_intent.succeeded":
        return { action: "captured", data: { session_id: sessionId, amount } }
      case "payment_intent.amount_capturable_updated":
        return { action: "authorized", data: { session_id: sessionId, amount } }
      case "payment_intent.payment_failed":
        return { action: "failed", data: { session_id: sessionId, amount } }
      default:
        return { action: "not_supported" }
    }
  }
}

export default StripeConnectPaymentProviderService
