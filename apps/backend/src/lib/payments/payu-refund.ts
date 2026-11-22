import { createHash } from "crypto"

/**
 * PayU refunds, from the classic postservice API (#2580).
 *
 * Sources (read 2026-11-22):
 * - Refund: https://docs.payu.in/reference/refund_transaction_api
 * - Error codes: https://docs.payu.in/reference/error-codes-for-refund-initiation
 * - Status by PayU id: https://docs.payu.in/reference/check_action_status_api_with_payu_id
 * - Status by txnid: https://docs.payu.in/reference/get_all_refunds_from_transaction_ids_api
 *
 * Proven live 2026-11-22 on order #158: `cancel_refund_transaction` returned
 * `{status:1, msg:"Refund Request Queued", error_code:102, request_id}`, and
 * `check_action_status` (var2 = "payuid") then listed it as `action: refund,
 * status: pending, refund_mode: "Instant Credit through UPI"`.
 *
 * 🔴 `check_action_status` needs `var2=payuid` when var1 is a mihpayid —
 * without it PayU answers "Invalid command name", which reads like the API
 * does not exist. `getAllRefundsFromTxnIds` takes the PayU-side txnid (for a
 * UPI-QR payment that is our `upi…` id, not Medusa's `medusa_…` session id).
 */

const sha512Hex = (s: string) => createHash("sha512").update(s).digest("hex")

export const payuPostserviceUrl = (mode?: string): string => {
  const m = String(mode || "test").toLowerCase()
  const live = m === "live" || m === "prod" || m === "production"
  return `${live ? "https://info.payu.in" : "https://test.payu.in"}/merchant/postservice.php?form=2`
}

/** sha512(key|command|var1|salt) — the hash every postservice command uses. */
export const postserviceHash = (key: string, command: string, var1: string, salt: string) =>
  sha512Hex([key, command, var1, salt].join("|"))

/** PayU: "Token ID length should not be greater than 23 characters", unique per request. */
export const PAYU_REFUND_TOKEN_MAX = 23

export const newRefundToken = (prefix = "rf", now: Date = new Date()): string => {
  const t = `${prefix}${now.getTime().toString(36)}${Math.random().toString(36).slice(2, 8)}`
  return t.slice(0, PAYU_REFUND_TOKEN_MAX)
}

/** Refund-initiation codes PayU documents as accepted; everything else failed. */
const ACCEPTED_CODES = new Set([100, 101, 102])

/** Plain words for the documented failure codes a human will meet. */
const CODE_WORDS: Record<number, string> = {
  105: "Invalid amount",
  106: "That refund token was already used",
  109: "This refund request is already logged",
  116: "PayU cannot find this payment",
  117: "Amount does not match",
  128: "Partial refunds are not allowed on this payment",
  130: "Refunds are no longer allowed for this payment",
  214: "A refund of the same amount was made in the last 5 minutes",
  225: "PayU account overdraft; check the refund status tomorrow",
  226: "The payment was captured today; check the refund status tomorrow",
  227: "Same amount and token already used",
  239: "Instant refunds are not activated on this PayU account",
  252: "Refunds are not allowed for this merchant",
  255: "Refund token is longer than 23 characters",
  263: "Invalid requested amount",
  303: "Amount is more than can be refunded",
  305: "Amount is more than allowed",
  500: "PayU had an internal error",
}

export type RefundInitiation = {
  accepted: boolean
  /** PayU's id for this refund — what the status check is asked about. */
  request_id: string | null
  error_code: number | null
  message: string
  /** Refund queued, but PayU says to check tomorrow (same-day capture/overdraft). */
  check_tomorrow: boolean
}

export const interpretRefundResponse = (json: any): RefundInitiation => {
  const code = json?.error_code !== undefined && json?.error_code !== null ? Number(json.error_code) : null
  const msg = String(json?.msg ?? "")
  const checkTomorrow = code === 225 || code === 226 || /tomorrow/i.test(msg)
  const accepted =
    Number(json?.status) === 1 &&
    (code === null || ACCEPTED_CODES.has(code) || checkTomorrow) &&
    !/failed/i.test(msg)
  return {
    accepted,
    request_id: json?.request_id !== undefined && json?.request_id !== null ? String(json.request_id) : null,
    error_code: code,
    message: accepted ? msg || "Refund accepted" : (code !== null && CODE_WORDS[code]) || msg || "PayU refused the refund",
    check_tomorrow: checkTomorrow,
  }
}

export type PayuCreds = { key: string; salt: string; mode?: string }

/**
 * Ask PayU to refund a captured payment (full or partial). Never throws for a
 * PayU refusal — the answer is returned so the caller can say what happened.
 */
export const refundPayuPayment = async (
  creds: PayuCreds,
  input: { mihpayid: string; amount: number; token?: string; remarks?: string },
  fetchImpl: typeof fetch = fetch
): Promise<RefundInitiation & { token: string }> => {
  const token = (input.token || newRefundToken()).slice(0, PAYU_REFUND_TOKEN_MAX)
  if (!Number.isFinite(input.amount) || input.amount <= 0) {
    return { accepted: false, request_id: null, error_code: null, message: "Refund amount must be positive", check_tomorrow: false, token }
  }
  const command = "cancel_refund_transaction"
  const params: Record<string, string> = {
    key: creds.key,
    command,
    var1: String(input.mihpayid),
    var2: token,
    var3: input.amount.toFixed(2),
    hash: postserviceHash(creds.key, command, String(input.mihpayid), creds.salt),
  }
  if (input.remarks) {
    // PayU drops remarks containing these characters; strip them up front.
    const clean = input.remarks.replace(/[#$%^&*+=[\]\\';/{}:<>?~]/g, " ").slice(0, 1000)
    params.var9 = JSON.stringify({ refundDetails: { remarks: clean } })
  }
  const res = await fetchImpl(payuPostserviceUrl(creds.mode), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params).toString(),
  })
  const json: any = await res.json().catch(() => ({}))
  return { ...interpretRefundResponse(json), token }
}

export type PayuRefundState = "queued" | "pending" | "success" | "failure" | "unknown"

export type PayuRefundRecord = {
  request_id: string
  token: string | null
  amount: number | null
  status: PayuRefundState
  /** e.g. "Instant Credit through UPI". */
  refund_mode: string | null
  bank_ref_num: string | null
  bank_arn: string | null
}

const normaliseState = (s: unknown): PayuRefundState => {
  const v = String(s ?? "").toLowerCase().replace(/\s+/g, "_")
  if (v === "success") return "success"
  if (v === "failure" || v === "failed") return "failure"
  if (v === "queued" || v === "requested") return "queued"
  if (v === "pending" || v === "in_progress" || v === "processing" || v === "od_hit") return "pending"
  return "unknown"
}

/** The refund actions in a `check_action_status` (by PayU id) answer. Captures are skipped. */
export const interpretActionStatus = (json: any, mihpayid: string): PayuRefundRecord[] => {
  const actions = json?.transaction_details?.[mihpayid]
  if (Number(json?.status) !== 1 || !actions || typeof actions !== "object") return []
  return Object.values(actions as Record<string, any>)
    .filter((a) => String(a?.action || "").toLowerCase() === "refund")
    .map((a) => {
      const amt = Number(a?.amt)
      return {
        request_id: String(a?.request_id ?? ""),
        token: a?.token ? String(a.token) : null,
        amount: Number.isFinite(amt) ? amt : null,
        status: normaliseState(a?.status),
        refund_mode: a?.refund_mode && a.refund_mode !== "-" ? String(a.refund_mode) : null,
        bank_ref_num: a?.bank_ref_num ? String(a.bank_ref_num) : null,
        bank_arn: a?.bank_arn ? String(a.bank_arn) : null,
      }
    })
}

/** Every refund PayU holds against a payment, with its live status. */
export const getPayuRefunds = async (
  creds: PayuCreds,
  mihpayid: string,
  fetchImpl: typeof fetch = fetch
): Promise<PayuRefundRecord[]> => {
  const command = "check_action_status"
  const res = await fetchImpl(payuPostserviceUrl(creds.mode), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      key: creds.key,
      command,
      var1: String(mihpayid),
      // 🔴 Required when var1 is a PayU id; without it: "Invalid command name".
      var2: "payuid",
      hash: postserviceHash(creds.key, command, String(mihpayid), creds.salt),
    }).toString(),
  })
  const json: any = await res.json().catch(() => ({}))
  return interpretActionStatus(json, String(mihpayid))
}
