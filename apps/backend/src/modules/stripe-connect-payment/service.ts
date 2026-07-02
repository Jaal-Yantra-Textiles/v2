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
  fromStripeMinorUnits,
  mapStripeStatus,
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

/**
 * Storefront payment provider that routes a partner's checkout INTO their
 * Stripe Connect (Standard) account via **direct charges** with an
 * application_fee_amount to the platform.
 *
 * The connected account + fee are resolved UPSTREAM (in the route/workflow via
 * resolvePartnerConnect, which has query access) and handed down through the
 * payment-session `context` — payment providers run in an isolated module
 * container with no access to `query` or other modules, so they cannot resolve
 * the partner themselves.
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

  async initiatePayment(
    input: InitiatePaymentInput
  ): Promise<InitiatePaymentOutput> {
    const { amount, currency_code, context, data } = input
    const stripe = await this.getStripe()
    const minor = toStripeMinorUnits(Number(amount), currency_code)
    const sessionId = (data?.session_id as string) || ""
    const email =
      (context as any)?.email || (context?.customer as any)?.email || undefined

    // Resolved upstream by resolvePartnerConnect and passed via context — the
    // provider can't reach query/other modules to resolve it itself.
    const connectAccountId = (context as any)?.connect_account_id as string | undefined
    const partnerId = (context as any)?.connect_partner_id as string | undefined
    const ctxFeePercent = (context as any)?.connect_fee_percent

    if (connectAccountId) {
      const pct =
        ctxFeePercent != null
          ? Number(ctxFeePercent)
          : this.options_.defaultFeePercent ?? 0
      const fee = computeApplicationFee(minor, pct)

      const intent = await stripe.paymentIntents.create(
        {
          amount: minor,
          currency: currency_code.toLowerCase(),
          automatic_payment_methods: { enabled: true },
          ...(fee > 0 ? { application_fee_amount: fee } : {}),
          ...(email ? { receipt_email: email } : {}),
          metadata: {
            partner_id: partnerId ?? "",
            session_id: sessionId,
            platform: "jyt",
          },
        },
        this.accountOpts(connectAccountId)
      )

      this.logger_.info(
        `[stripe-connect] direct charge on ${connectAccountId} ` +
          `amount=${minor}${currency_code} fee=${fee} (partner=${partnerId})`
      )

      return {
        id: intent.id,
        data: {
          id: intent.id,
          client_secret: intent.client_secret,
          connect_account_id: connectAccountId,
          partner_id: partnerId,
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

    // Recompute the application fee for the new amount at the original rate
    // (direct charges allow updating application_fee_amount pre-capture).
    const prevAmount = Number(data?.amount) || 0
    const prevFee = Number(data?.application_fee_amount) || 0
    const rate = prevAmount > 0 ? prevFee / prevAmount : 0
    const fee = connectAccountId ? Math.round(minor * rate) : 0

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
    const currency = intent?.currency || "eur"

    if (!sessionId) return { action: "not_supported" }

    // Report amounts in MAJOR units — Medusa's processPaymentWorkflow expects
    // the same convention as @medusajs/payment-stripe.
    switch (type) {
      case "payment_intent.succeeded":
        return {
          action: "captured",
          data: {
            session_id: sessionId,
            amount: fromStripeMinorUnits(
              intent.amount_received ?? intent.amount,
              currency
            ),
          },
        }
      case "payment_intent.amount_capturable_updated":
        return {
          action: "authorized",
          data: {
            session_id: sessionId,
            amount: fromStripeMinorUnits(
              intent.amount_capturable ?? intent.amount,
              currency
            ),
          },
        }
      case "payment_intent.payment_failed":
        return {
          action: "failed",
          data: {
            session_id: sessionId,
            amount: fromStripeMinorUnits(intent.amount, currency),
          },
        }
      default:
        return { action: "not_supported" }
    }
  }
}

export default StripeConnectPaymentProviderService
