import crypto from "crypto"
import { AbstractPaymentProvider, PaymentSessionStatus } from "@medusajs/framework/utils"
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
  RefundPaymentInput,
  RefundPaymentOutput,
  RetrievePaymentInput,
  RetrievePaymentOutput,
  UpdatePaymentInput,
  UpdatePaymentOutput,
  WebhookActionResult,
} from "@medusajs/framework/types"
import { Logger } from "@medusajs/framework/types"

type PayUOptions = {
  merchant_key: string
  merchant_salt: string
  mode?: "test" | "live"
  auto_capture?: boolean
}

type InjectedDependencies = {
  logger: Logger
}

const PAYU_TEST_URL = "https://test.payu.in/_payment"
const PAYU_LIVE_URL = "https://secure.payu.in/_payment"
const PAYU_INFO_URL_TEST = "https://test.payu.in/merchant/postservice.php"
const PAYU_INFO_URL_LIVE = "https://info.payu.in/merchant/postservice.php"

class PayUPaymentProviderService extends AbstractPaymentProvider<PayUOptions> {
  static identifier = "payu"

  protected logger_: Logger
  protected options_: PayUOptions
  protected container_: any

  constructor(container: InjectedDependencies, options: PayUOptions) {
    super(container, options)
    this.logger_ = container.logger
    this.options_ = options
    this.container_ = container
  }

  static validateOptions(options: Record<any, any>): void {
    if (!options.merchant_key) {
      throw new Error("PayU merchant_key is required")
    }
    if (!options.merchant_salt) {
      throw new Error("PayU merchant_salt is required")
    }
  }

  /**
   * Resolve PayU credentials: partner-specific > global defaults.
   *
   * Partner credentials are resolved UPSTREAM (in the store payment-sessions
   * route via `resolvePartnerPayuCredentials`, which has `query` access) and
   * handed down through the payment-session `context` as `payu_merchant_key` /
   * `payu_merchant_salt` / `payu_mode`. Payment providers run in an isolated
   * module container with no access to `query` or other modules, so they
   * cannot resolve the partner themselves — an earlier version tried to and
   * silently fell back to the platform's global creds every time. Mirrors the
   * Stripe Connect provider, which reads its connected account from context.
   *
   * Falls back to this.options_ (global credentials from medusa-config.ts) when
   * no partner-specific credentials were injected.
   */
  private resolveCredentials(context?: Record<string, unknown>): PayUOptions {
    if (!context) return this.options_

    const ctx = context as any
    const merchant_key = ctx.payu_merchant_key ?? ctx.extra?.payu_merchant_key
    const merchant_salt = ctx.payu_merchant_salt ?? ctx.extra?.payu_merchant_salt
    const mode = ctx.payu_mode ?? ctx.extra?.payu_mode

    if (merchant_key && merchant_salt) {
      this.logger_.info(
        `[PayU] Using partner credentials (partner=${ctx.payu_partner_id ?? "unknown"})`
      )
      return {
        merchant_key,
        merchant_salt,
        mode: mode || this.options_.mode,
        auto_capture: this.options_.auto_capture,
      }
    }

    return this.options_
  }

  /**
   * Resolve credentials from payment session data (for operations after initiate
   * where context may not be available, but we stored partner info in the session).
   */
  private resolveFromSessionData(data?: Record<string, unknown>): PayUOptions | null {
    if (!data?.partner_merchant_key || !data?.partner_merchant_salt) return null
    return {
      merchant_key: data.partner_merchant_key as string,
      merchant_salt: data.partner_merchant_salt as string,
      mode: (data.partner_mode as "test" | "live") || this.options_.mode,
      auto_capture: this.options_.auto_capture,
    }
  }

  private getPaymentUrl(opts: PayUOptions): string {
    return opts.mode === "live" ? PAYU_LIVE_URL : PAYU_TEST_URL
  }

  private getInfoUrl(opts: PayUOptions): string {
    return opts.mode === "live" ? PAYU_INFO_URL_LIVE : PAYU_INFO_URL_TEST
  }

  private generateHashWithOpts(opts: PayUOptions, params: {
    txnid: string
    amount: string
    productinfo: string
    firstname: string
    email: string
    udf1?: string
    udf2?: string
    udf3?: string
    udf4?: string
    udf5?: string
  }): string {
    const {
      txnid, amount, productinfo, firstname, email,
      udf1 = "", udf2 = "", udf3 = "", udf4 = "", udf5 = "",
    } = params

    const hashString = `${opts.merchant_key}|${txnid}|${amount}|${productinfo}|${firstname}|${email}|${udf1}|${udf2}|${udf3}|${udf4}|${udf5}||||||${opts.merchant_salt}`
    return crypto.createHash("sha512").update(hashString).digest("hex")
  }

  private generateApiHashWithOpts(opts: PayUOptions, command: string, var1: string): string {
    const hashString = `${opts.merchant_key}|${command}|${var1}|${opts.merchant_salt}`
    return crypto.createHash("sha512").update(hashString).digest("hex")
  }

  // Keep legacy methods for backwards compat
  private generateHash(params: {
    txnid: string; amount: string; productinfo: string; firstname: string; email: string;
    udf1?: string; udf2?: string; udf3?: string; udf4?: string; udf5?: string;
  }): string {
    return this.generateHashWithOpts(this.options_, params)
  }

  private generateApiHash(command: string, var1: string): string {
    return this.generateApiHashWithOpts(this.options_, command, var1)
  }

  private generateTxnId(): string {
    return `medusa_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`
  }

  private toAmount(amount: number | { valueOf(): number } | any): string {
    const num = typeof amount === "number" ? amount : Number(amount)
    return num.toFixed(2)
  }

  async initiatePayment(
    input: InitiatePaymentInput
  ): Promise<InitiatePaymentOutput> {
    const { amount, currency_code, context, data } = input

    // Resolve partner-specific (injected via context upstream) or global credentials
    const opts = this.resolveCredentials(context)

    const txnid = this.generateTxnId()
    const amountStr = this.toAmount(amount)
    const firstname = (context?.customer as any)?.first_name || "Customer"
    const email = (context as any)?.email || (context?.customer as any)?.email || ""
    const phone = (context?.customer as any)?.phone || ""
    const productinfo = `Order ${txnid}`

    const udf1 = (data?.session_id as string) || ""

    const hash = this.generateHashWithOpts(opts, {
      txnid, amount: amountStr, productinfo, firstname, email, udf1,
    })

    const isPartnerCreds = opts.merchant_key !== this.options_.merchant_key
    this.logger_.info(`[PayU] Initiated payment: txnid=${txnid}, amount=${amountStr} ${currency_code}, partner_creds=${isPartnerCreds}`)

    return {
      id: txnid,
      data: {
        txnid,
        amount: amountStr,
        productinfo,
        firstname,
        email,
        phone,
        udf1,
        hash,
        key: opts.merchant_key,
        payment_url: this.getPaymentUrl(opts),
        currency: currency_code?.toUpperCase() || "INR",
        status: "pending",
        // Store partner credentials reference in session for subsequent operations
        ...(isPartnerCreds
          ? {
              partner_merchant_key: opts.merchant_key,
              partner_merchant_salt: opts.merchant_salt,
              partner_mode: opts.mode,
            }
          : {}),
      },
    }
  }

  async authorizePayment(
    input: AuthorizePaymentInput
  ): Promise<AuthorizePaymentOutput> {
    const { data } = input
    const opts = this.resolveFromSessionData(data) || this.options_
    const payuStatus = ((data?.payu_status as string) || (data?.status as string) || "").toLowerCase()
    const mihpayid = (data?.mihpayid as string) || ""
    const txnid = (data?.txnid as string) || ""

    if (payuStatus === "success" || payuStatus === "captured") {
      let verifiedMihpayid = mihpayid
      let isVerified = false

      if (txnid) {
        try {
          const verified = await this.verifyPaymentWithOpts(opts, txnid)
          if (verified.status === "success" || verified.status === "captured") {
            verifiedMihpayid = verified.mihpayid || mihpayid
            isVerified = true
          }
        } catch (e: any) {
          this.logger_.warn(`[PayU] Verify API failed (proceeding with callback data): ${e.message}`)
        }
      }

      if (isVerified || mihpayid) {
        const finalStatus = this.options_.auto_capture ? "captured" : "authorized"
        this.logger_.info(`[PayU] ${finalStatus}: txnid=${txnid}, mihpayid=${verifiedMihpayid}, verified=${isVerified}`)
        return {
          data: { ...data, mihpayid: verifiedMihpayid, verified: isVerified },
          status: finalStatus as any,
        }
      }

      this.logger_.warn(`[PayU] Success status but no mihpayid and verify failed: txnid=${txnid}`)
    }

    if (payuStatus === "failure" || payuStatus === "failed") {
      return { data: { ...data }, status: "error" }
    }

    return { data: { ...data }, status: "pending" }
  }

  async capturePayment(input: CapturePaymentInput): Promise<CapturePaymentOutput> {
    const { data } = input
    const opts = this.resolveFromSessionData(data) || this.options_
    const txnid = data?.txnid as string
    try {
      const verified = await this.verifyPaymentWithOpts(opts, txnid)
      this.logger_.info(`[PayU] Captured: txnid=${txnid}`)
      return { data: { ...data, mihpayid: verified.mihpayid, captured_at: new Date().toISOString() } }
    } catch {
      return { data: { ...data } }
    }
  }

  async refundPayment(input: RefundPaymentInput): Promise<RefundPaymentOutput> {
    const { data, amount } = input
    const opts = this.resolveFromSessionData(data) || this.options_
    const mihpayid = data?.mihpayid as string
    if (!mihpayid) throw new Error("PayU mihpayid required for refund")

    const refundAmount = this.toAmount(amount)
    const tokenId = `refund_${Date.now()}`
    const hash = this.generateApiHashWithOpts(opts, "cancel_refund_transaction", mihpayid)

    const params = new URLSearchParams({
      key: opts.merchant_key,
      command: "cancel_refund_transaction",
      hash,
      var1: mihpayid,
      var2: tokenId,
      var3: refundAmount,
    })

    const response = await fetch(this.getInfoUrl(opts), {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    })
    const result = await response.json()
    this.logger_.info(`[PayU] Refund: ${JSON.stringify(result)}`)

    if (result.status === 1 || result.msg === "Refund Initiated") {
      return { data: { ...data, refund_id: tokenId, refund_amount: refundAmount } }
    }
    throw new Error(`PayU refund failed: ${result.msg || JSON.stringify(result)}`)
  }

  async cancelPayment(input: CancelPaymentInput): Promise<CancelPaymentOutput> {
    return { data: { ...input.data, status: "canceled" } }
  }

  async deletePayment(input: DeletePaymentInput): Promise<DeletePaymentOutput> {
    return { data: { ...input.data, status: "deleted" } }
  }

  async retrievePayment(input: RetrievePaymentInput): Promise<RetrievePaymentOutput> {
    const txnid = input.data?.txnid as string
    if (!txnid) return { data: input.data }
    const opts = this.resolveFromSessionData(input.data) || this.options_
    try {
      const result = await this.verifyPaymentWithOpts(opts, txnid)
      return { data: { ...input.data, ...result } }
    } catch {
      return { data: input.data }
    }
  }

  async getPaymentStatus(input: GetPaymentStatusInput): Promise<GetPaymentStatusOutput> {
    const data = input.data || {}
    const status = ((data.status as string) || "").toLowerCase()

    if (status === "captured" || status === "success") {
      return { status: PaymentSessionStatus.CAPTURED }
    }
    if (status === "authorized") {
      return { status: PaymentSessionStatus.AUTHORIZED }
    }
    if (status === "failed" || status === "failure" || status === "error") {
      return { status: PaymentSessionStatus.ERROR }
    }
    if (status === "canceled") {
      return { status: PaymentSessionStatus.CANCELED }
    }
    return { status: PaymentSessionStatus.PENDING }
  }

  async updatePayment(input: UpdatePaymentInput): Promise<UpdatePaymentOutput> {
    const { amount, currency_code, context, data } = input
    const opts = this.resolveFromSessionData(data) || this.resolveCredentials(context) || this.options_

    if (amount && data?.txnid) {
      const amountStr = this.toAmount(amount)
      const hash = this.generateHashWithOpts(opts, {
        txnid: data.txnid as string,
        amount: amountStr,
        productinfo: (data.productinfo as string) || `Order ${data.txnid}`,
        firstname: (context?.customer as any)?.first_name || (data.firstname as string) || "Customer",
        email: (context as any)?.email || (data.email as string) || "",
      })
      return { data: { ...data, amount: amountStr, hash, key: opts.merchant_key, currency: currency_code?.toUpperCase() || "INR" } }
    }
    return { data: { ...data } }
  }

  async getWebhookActionAndData(payload: {
    data: Record<string, unknown>
    rawData: string | Buffer
    headers: Record<string, unknown>
  }): Promise<WebhookActionResult> {
    const { data } = payload
    const status = ((data?.status as string) || "").toLowerCase()
    const txnid = data?.txnid as string

    // Resolve credentials from session data stored during initiate
    const opts = this.resolveFromSessionData(data) || this.options_

    if (data?.hash && txnid) {
      const reverseHashString = `${opts.merchant_salt}|${data.status}||||||${data.udf5 || ""}|${data.udf4 || ""}|${data.udf3 || ""}|${data.udf2 || ""}|${data.udf1 || ""}|${data.email || ""}|${data.firstname || ""}|${data.productinfo || ""}|${data.amount || ""}|${txnid}|${opts.merchant_key}`
      const expectedHash = crypto.createHash("sha512").update(reverseHashString).digest("hex")
      if (expectedHash !== data.hash) {
        this.logger_.warn(`[PayU] Webhook hash mismatch: txnid=${txnid}`)
        return { action: "not_supported" }
      }
    }

    if (status === "success" || status === "captured") {
      return { action: "captured", data: { session_id: txnid, amount: data.amount as number } }
    }
    if (status === "failure" || status === "failed") {
      return { action: "failed", data: { session_id: txnid, amount: data.amount as number } }
    }
    return { action: "not_supported" }
  }

  private async verifyPaymentWithOpts(opts: PayUOptions, txnid: string): Promise<Record<string, any>> {
    const hash = this.generateApiHashWithOpts(opts, "verify_payment", txnid)
    const params = new URLSearchParams({
      key: opts.merchant_key,
      command: "verify_payment",
      hash,
      var1: txnid,
    })

    const response = await fetch(this.getInfoUrl(opts), {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    })
    const result = await response.json()

    if (result.status === 1 && result.transaction_details?.[txnid]) {
      return result.transaction_details[txnid]
    }
    throw new Error(`PayU verify failed: ${result.msg || "Unknown error"}`)
  }

  // Legacy verify (uses global credentials)
  private async verifyPayment(txnid: string): Promise<Record<string, any>> {
    return this.verifyPaymentWithOpts(this.options_, txnid)
  }
}

export default PayUPaymentProviderService
