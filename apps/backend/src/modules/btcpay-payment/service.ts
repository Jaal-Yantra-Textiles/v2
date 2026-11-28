import { AbstractPaymentProvider, PaymentSessionStatus } from "@medusajs/framework/utils"
import type {
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
  type BtcpayConfig,
  createInvoice,
  getInvoice,
  invalidateInvoice,
  refundInvoice,
} from "./lib/btcpay-client"
import { btcpaySignatureValid, invoiceVerdict, storeWebhookSecret, toBtcpayAmount } from "./lib/verdict"

export type BtcpayOptions = {
  /** e.g. https://btcpay.example.com — BTCPAY_SERVER_URL */
  server_url: string
  /** Greenfield API key — BTCPAY_SERVER_KEY */
  api_key: string
  /** OUR store: the fallback for the main store and any partner without one — BTCPAY_SERVER_ID */
  store_id: string
  /** Master secret per-store webhook secrets derive from — BTCPAY_WEBHOOK_SECRET */
  webhook_secret: string
  /** Where the buyer lands after paying when the storefront sent no return_url */
  default_return_url?: string
}

type Deps = { logger: Logger }

/**
 * Bitcoin via BTCPay Server (#BTC). Provider id `pp_btcpay_btcpay`.
 *
 * Flow: initiate → a BTCPay invoice in the CART's currency (BTCPay converts at
 * the store's rate source) → the buyer pays on BTCPay's checkout page →
 * BTCPay's InvoiceSettled webhook → Medusa calls authorizePayment, which
 * re-fetches the invoice and runs `invoiceVerdict` → captured → cart completes.
 * On-chain confirmation takes 10–60 min, so the order is usually placed by the
 * webhook, not by the buyer's return.
 *
 * Partner storefronts: the store payment-sessions route resolves the partner's
 * BTCPay store id upstream and passes it as `context.btcpay_store_id`
 * (providers can't query). No partner secret exists: one API key covers every
 * store on our account, and webhook secrets are derived per store.
 */
class BtcpayPaymentProviderService extends AbstractPaymentProvider<BtcpayOptions> {
  static identifier = "btcpay"

  protected logger_: Logger
  protected options_: BtcpayOptions

  constructor(container: Deps, options: BtcpayOptions) {
    super(container, options)
    this.logger_ = container.logger
    this.options_ = options
  }

  static validateOptions(options: Record<any, any>): void {
    for (const k of ["server_url", "api_key", "store_id", "webhook_secret"]) {
      if (!options[k]) throw new Error(`BTCPay ${k} is required`)
    }
    if (!/^https:\/\//i.test(String(options.server_url))) {
      throw new Error("BTCPay server_url must be https://")
    }
  }

  private cfg(): BtcpayConfig {
    return { server_url: this.options_.server_url, api_key: this.options_.api_key }
  }

  /** The store a session's invoice lives in: partner (from context) or ours. */
  private storeFor(context?: Record<string, unknown>): string {
    const ctx = (context || {}) as any
    return String(ctx.btcpay_store_id ?? ctx.extra?.btcpay_store_id ?? "") || this.options_.store_id
  }

  private returnUrl(data?: Record<string, unknown>): string | undefined {
    const raw = String(data?.return_url || "") || this.options_.default_return_url || ""
    return /^https:\/\//i.test(raw) ? raw : undefined
  }

  private async newInvoice(
    amount: unknown,
    currency_code: string,
    data: Record<string, unknown> | undefined,
    context: Record<string, unknown> | undefined,
    storeId?: string
  ) {
    const store = storeId || this.storeFor(context)
    const sessionId = String(data?.session_id || "")
    const amountStr = toBtcpayAmount(amount)
    const currency = String(currency_code || "").toUpperCase()
    const partnerId = (context as any)?.btcpay_partner_id

    const inv = await createInvoice(this.cfg(), store, {
      amount: amountStr,
      currency,
      metadata: {
        medusa_session_id: sessionId,
        orderId: sessionId, // shows in BTCPay's UI and redirect {OrderId}
        ...(partnerId ? { partner_id: partnerId } : {}),
      },
      redirectURL: this.returnUrl(data),
    })
    this.logger_.info(
      `[BTCPay] invoice ${inv.id} store=${store} ${amountStr} ${currency} session=${sessionId}${partnerId ? ` partner=${partnerId}` : ""}`
    )
    return {
      invoice_id: inv.id,
      checkout_link: inv.checkoutLink,
      btcpay_store_id: store,
      amount: amountStr,
      currency,
      session_id: sessionId,
      ...(partnerId ? { partner_id: partnerId } : {}),
      status: "pending",
    }
  }

  async initiatePayment(input: InitiatePaymentInput): Promise<InitiatePaymentOutput> {
    const data = await this.newInvoice(input.amount, input.currency_code, input.data, input.context)
    return { id: data.invoice_id, data }
  }

  /** An invoice's amount is fixed: a changed cart total needs a new invoice. */
  async updatePayment(input: UpdatePaymentInput): Promise<UpdatePaymentOutput> {
    const { data = {}, amount, currency_code, context } = input
    const sameAmount = data.amount === toBtcpayAmount(amount)
    const sameCurrency = String(data.currency || "") === String(currency_code || "").toUpperCase()
    if (data.invoice_id && sameAmount && sameCurrency) return { data }
    const next = await this.newInvoice(amount, currency_code, data, context, data.btcpay_store_id as string)
    await this.retireInvoice(data, "cart total changed")
    return { data: { ...data, ...next } }
  }

  async authorizePayment(input: AuthorizePaymentInput): Promise<AuthorizePaymentOutput> {
    const data = input.data || {}
    const invoiceId = String(data.invoice_id || "")
    if (!invoiceId) return { data, status: PaymentSessionStatus.PENDING }

    const store = String(data.btcpay_store_id || "") || this.options_.store_id
    let inv
    try {
      inv = await getInvoice(this.cfg(), store, invoiceId)
    } catch (e: any) {
      this.logger_.warn(`[BTCPay] could not read invoice ${invoiceId}: ${e.message}`)
      return { data, status: PaymentSessionStatus.PENDING }
    }

    const v = invoiceVerdict(inv, {
      sessionId: String(data.session_id || ""),
      amount: Number(data.amount),
      currency: String(data.currency || ""),
      storeId: store,
    })
    const next = { ...data, btcpay_status: inv.status, btcpay_additional_status: inv.additionalStatus, verdict: v.reason }

    if (v.verdict === "paid") {
      this.logger_.info(`[BTCPay] captured: invoice ${invoiceId} (${v.reason})`)
      return { data: { ...next, status: "captured", verified: true }, status: PaymentSessionStatus.CAPTURED }
    }
    if (v.verdict === "failed") {
      this.logger_.warn(`[BTCPay] not paid: invoice ${invoiceId} — ${v.reason}`)
      return { data: { ...next, status: "error" }, status: PaymentSessionStatus.ERROR }
    }
    if (v.verdict === "review") {
      this.logger_.warn(`[BTCPay] NEEDS REVIEW: invoice ${invoiceId} — ${v.reason} (order not placed)`)
    }
    return { data: next, status: PaymentSessionStatus.PENDING }
  }

  /** Bitcoin is final once settled; authorize already captured. */
  async capturePayment(input: CapturePaymentInput): Promise<CapturePaymentOutput> {
    return { data: { ...input.data, captured_at: new Date().toISOString() } }
  }

  /**
   * Creates a pull payment for `amount` (fiat, current rate). Nothing is sent
   * until the BUYER opens `refund_link` and claims it — share that link.
   */
  async refundPayment(input: RefundPaymentInput): Promise<RefundPaymentOutput> {
    const data = input.data || {}
    const invoiceId = String(data.invoice_id || "")
    if (!invoiceId) throw new Error("BTCPay invoice_id required for refund")
    const store = String(data.btcpay_store_id || "") || this.options_.store_id
    const amount = toBtcpayAmount(input.amount)
    const pp = await refundInvoice(this.cfg(), store, invoiceId, amount, String(data.currency || ""))
    this.logger_.info(`[BTCPay] refund pull payment ${pp.id} for invoice ${invoiceId}: ${amount} ${data.currency}`)
    // One entry per refund: an order can be refunded more than once, and each
    // has its own claim link the buyer must open.
    const prior = Array.isArray(data.btcpay_refunds) ? (data.btcpay_refunds as any[]) : []
    const entry = {
      pull_payment_id: pp.id,
      link: pp.viewLink,
      amount,
      currency: String(data.currency || ""),
      created_at: new Date().toISOString(),
    }
    return {
      data: {
        ...data,
        btcpay_refunds: [...prior, entry],
        refund_pull_payment_id: pp.id,
        refund_link: pp.viewLink,
        refund_amount: amount,
      },
    }
  }

  async cancelPayment(input: CancelPaymentInput): Promise<CancelPaymentOutput> {
    await this.retireInvoice(input.data, "payment canceled")
    return { data: { ...input.data, status: "canceled" } }
  }

  /**
   * Medusa deletes a session whenever the buyer re-picks a payment method or
   * the checkout re-initiates. Its invoice must not stay payable: money sent
   * to it would land with no session to place an order from.
   */
  async deletePayment(input: DeletePaymentInput): Promise<DeletePaymentOutput> {
    await this.retireInvoice(input.data, "checkout session replaced")
    return { data: { ...input.data, status: "deleted" } }
  }

  /**
   * Invalidate an invoice ONLY while nothing has been paid into it (status New,
   * no additional status). Anything else (Processing, Settled, PaidPartial…)
   * means money is moving and a human must look, so it is left alone.
   * Never throws: failing to retire must not block the buyer's checkout.
   */
  private async retireInvoice(data: Record<string, unknown> | undefined, why: string): Promise<void> {
    const invoiceId = String(data?.invoice_id || "")
    if (!invoiceId) return
    const store = String(data?.btcpay_store_id || "") || this.options_.store_id
    try {
      const inv = await getInvoice(this.cfg(), store, invoiceId)
      if (inv.status !== "New" || (inv.additionalStatus || "None") !== "None") {
        if (inv.status !== "Invalid" && inv.status !== "Expired") {
          this.logger_.warn(`[BTCPay] kept invoice ${invoiceId} (${inv.status}/${inv.additionalStatus}) — ${why}; it has payment activity`)
        }
        return
      }
      await invalidateInvoice(this.cfg(), store, invoiceId)
      this.logger_.info(`[BTCPay] retired invoice ${invoiceId} — ${why}`)
    } catch (e: any) {
      this.logger_.warn(`[BTCPay] could not retire invoice ${invoiceId} (${why}): ${e.message}`)
    }
  }

  async retrievePayment(input: RetrievePaymentInput): Promise<RetrievePaymentOutput> {
    const data = input.data || {}
    if (!data.invoice_id) return { data }
    try {
      const inv = await getInvoice(this.cfg(), String(data.btcpay_store_id || this.options_.store_id), String(data.invoice_id))
      return { data: { ...data, btcpay_status: inv.status, btcpay_additional_status: inv.additionalStatus } }
    } catch {
      return { data }
    }
  }

  async getPaymentStatus(input: GetPaymentStatusInput): Promise<GetPaymentStatusOutput> {
    const s = String(input.data?.status || "").toLowerCase()
    if (s === "captured") return { status: PaymentSessionStatus.CAPTURED }
    if (s === "error") return { status: PaymentSessionStatus.ERROR }
    if (s === "canceled") return { status: PaymentSessionStatus.CANCELED }
    return { status: PaymentSessionStatus.PENDING }
  }

  /**
   * BTCPay → /hooks/payment/btcpay_btcpay. A valid signature only proves the
   * call came from BTCPay; whether the checkout is PAID is decided by
   * authorizePayment re-fetching the invoice, which Medusa runs next.
   */
  async getWebhookActionAndData(payload: {
    data: Record<string, unknown>
    rawData: string | Buffer
    headers: Record<string, unknown>
  }): Promise<WebhookActionResult> {
    const { data, rawData, headers } = payload
    const storeId = String(data?.storeId || "")
    const invoiceId = String(data?.invoiceId || "")
    const type = String(data?.type || "")
    const sig = headers?.["btcpay-sig"] ?? headers?.["BTCPay-Sig"]

    if (!storeId || !invoiceId || !rawData) return { action: "not_supported" }
    if (!btcpaySignatureValid(rawData, sig, storeWebhookSecret(this.options_.webhook_secret, storeId))) {
      this.logger_.warn(`[BTCPay] webhook rejected (bad signature): ${type} invoice=${invoiceId} store=${storeId}`)
      return { action: "not_supported" }
    }

    if (type !== "InvoiceSettled" && type !== "InvoicePaymentSettled" && type !== "InvoiceInvalid" && type !== "InvoiceExpired") {
      return { action: "not_supported" }
    }

    let inv
    try {
      inv = await getInvoice(this.cfg(), storeId, invoiceId)
    } catch (e: any) {
      // Throwing makes Medusa's event retry; BTCPay also redelivers.
      throw new Error(`[BTCPay] webhook: could not read invoice ${invoiceId}: ${e.message}`)
    }
    const sessionId = String(inv.metadata?.medusa_session_id || "")
    if (!sessionId) return { action: "not_supported" }
    const amount = Number(inv.amount)

    if (inv.status === "Settled") {
      this.logger_.info(`[BTCPay] webhook ${type}: invoice ${invoiceId} settled → session ${sessionId}`)
      return { action: "captured", data: { session_id: sessionId, amount } }
    }
    if (inv.status === "Invalid" || (inv.status === "Expired" && (inv.additionalStatus || "None") === "None")) {
      return { action: "failed", data: { session_id: sessionId, amount } }
    }
    return { action: "not_supported" }
  }
}

export default BtcpayPaymentProviderService
