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

  constructor(container: InjectedDependencies, options: PayUOptions) {
    super(container, options)
    this.logger_ = container.logger
    this.options_ = options
  }

  static validateOptions(options: Record<any, any>): void {
    if (!options.merchant_key) {
      throw new Error("PayU merchant_key is required")
    }
    if (!options.merchant_salt) {
      throw new Error("PayU merchant_salt is required")
    }
  }

  private get paymentUrl(): string {
    return this.options_.mode === "live" ? PAYU_LIVE_URL : PAYU_TEST_URL
  }

  private get infoUrl(): string {
    return this.options_.mode === "live" ? PAYU_INFO_URL_LIVE : PAYU_INFO_URL_TEST
  }

  private generateHash(params: {
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

    const hashString = `${this.options_.merchant_key}|${txnid}|${amount}|${productinfo}|${firstname}|${email}|${udf1}|${udf2}|${udf3}|${udf4}|${udf5}||||||${this.options_.merchant_salt}`
    return crypto.createHash("sha512").update(hashString).digest("hex")
  }

  private generateApiHash(command: string, var1: string): string {
    const hashString = `${this.options_.merchant_key}|${command}|${var1}|${this.options_.merchant_salt}`
    return crypto.createHash("sha512").update(hashString).digest("hex")
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
    const { amount, currency_code, context } = input

    const txnid = this.generateTxnId()
    const amountStr = this.toAmount(amount)
    const firstname = (context?.customer as any)?.first_name || "Customer"
    const email = (context as any)?.email || (context?.customer as any)?.email || ""
    const phone = (context?.customer as any)?.phone || ""
    const productinfo = `Order ${txnid}`

    const hash = this.generateHash({
      txnid, amount: amountStr, productinfo, firstname, email,
    })

    this.logger_.info(`[PayU] Initiated payment: txnid=${txnid}, amount=${amountStr} ${currency_code}`)

    return {
      id: txnid,
      data: {
        txnid,
        amount: amountStr,
        productinfo,
        firstname,
        email,
        phone,
        hash,
        key: this.options_.merchant_key,
        payment_url: this.paymentUrl,
        currency: currency_code?.toUpperCase() || "INR",
        status: "pending",
      },
    }
  }

  async authorizePayment(
    input: AuthorizePaymentInput
  ): Promise<AuthorizePaymentOutput> {
    const { data } = input
    const payuStatus = ((data?.payu_status as string) || (data?.status as string) || "").toLowerCase()
    const mihpayid = (data?.mihpayid as string) || ""
    const txnid = (data?.txnid as string) || ""

    if (payuStatus === "success" || payuStatus === "captured") {
      try {
        const verified = await this.verifyPayment(txnid)
        if (verified.status === "success" || verified.status === "captured") {
          this.logger_.info(`[PayU] Authorized: txnid=${txnid}, mihpayid=${mihpayid || verified.mihpayid}`)
          return {
            data: { ...data, mihpayid: mihpayid || verified.mihpayid, verified: true },
            status: "authorized",
          }
        }
      } catch (e: any) {
        this.logger_.error(`[PayU] Verify failed: ${e.message}`)
      }
    }

    if (this.options_.auto_capture && payuStatus === "success") {
      return { data: { ...data, mihpayid }, status: "captured" }
    }

    if (payuStatus === "failure" || payuStatus === "failed") {
      return { data: { ...data }, status: "error" }
    }

    return { data: { ...data }, status: "pending" }
  }

  async capturePayment(input: CapturePaymentInput): Promise<CapturePaymentOutput> {
    const { data } = input
    const txnid = data?.txnid as string
    try {
      const verified = await this.verifyPayment(txnid)
      this.logger_.info(`[PayU] Captured: txnid=${txnid}`)
      return { data: { ...data, mihpayid: verified.mihpayid, captured_at: new Date().toISOString() } }
    } catch {
      return { data: { ...data } }
    }
  }

  async refundPayment(input: RefundPaymentInput): Promise<RefundPaymentOutput> {
    const { data, amount } = input
    const mihpayid = data?.mihpayid as string
    if (!mihpayid) throw new Error("PayU mihpayid required for refund")

    const refundAmount = this.toAmount(amount)
    const tokenId = `refund_${Date.now()}`
    const hash = this.generateApiHash("cancel_refund_transaction", mihpayid)

    const params = new URLSearchParams({
      key: this.options_.merchant_key,
      command: "cancel_refund_transaction",
      hash,
      var1: mihpayid,
      var2: tokenId,
      var3: refundAmount,
    })

    const response = await fetch(this.infoUrl, {
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
    try {
      const result = await this.verifyPayment(txnid)
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

    if (amount && data?.txnid) {
      const amountStr = this.toAmount(amount)
      const hash = this.generateHash({
        txnid: data.txnid as string,
        amount: amountStr,
        productinfo: (data.productinfo as string) || `Order ${data.txnid}`,
        firstname: (context?.customer as any)?.first_name || (data.firstname as string) || "Customer",
        email: (context as any)?.email || (data.email as string) || "",
      })
      return { data: { ...data, amount: amountStr, hash, currency: currency_code?.toUpperCase() || "INR" } }
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

    if (data?.hash && txnid) {
      const reverseHashString = `${this.options_.merchant_salt}|${data.status}||||||${data.udf5 || ""}|${data.udf4 || ""}|${data.udf3 || ""}|${data.udf2 || ""}|${data.udf1 || ""}|${data.email || ""}|${data.firstname || ""}|${data.productinfo || ""}|${data.amount || ""}|${txnid}|${this.options_.merchant_key}`
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

  private async verifyPayment(txnid: string): Promise<Record<string, any>> {
    const hash = this.generateApiHash("verify_payment", txnid)
    const params = new URLSearchParams({
      key: this.options_.merchant_key,
      command: "verify_payment",
      hash,
      var1: txnid,
    })

    const response = await fetch(this.infoUrl, {
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
}

export default PayUPaymentProviderService
