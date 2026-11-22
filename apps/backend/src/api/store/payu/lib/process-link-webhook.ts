/**
 * Orchestrates a verified PayU payment-link webhook into an order.
 *
 * Authoritative gate = server-side re-verification, NOT the inbound hash (PayU
 * signs link webhooks with the unreproducible Salt-v2/RSA scheme — see
 * verify-payment.ts). Flow: re-query PayU for the txn (classic `verify_payment`,
 * then OneAPI `/txns` as a fallback); only if PayU independently confirms the
 * payment is successful and covers the cart total do we complete the cart.
 *
 * The inbound `hash` is verified best-effort by the route for logging only; it
 * never gates completion (a valid hash is also replay-able, so re-query wins).
 */
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import {
  isLinkPaid,
  oneapiHosts,
  oneapiLinkTxnsUrl,
} from "../payment-link/lib"
import { completeCartFromExternalPayment } from "./complete-from-external"
import { verifyPayuTransaction, type VerifyResult } from "./verify-payment"
import { scheduleIdFromLinkRef, settlePayuBalance } from "../../../../lib/payments/payu-balance"
import { planCartCollection } from "../../../../lib/payments/deposit-collection"
import { PAYMENT_SCHEDULE_MODULE } from "../../../../modules/payment_schedule"
import {
  isExtraPayment,
  PAYU_CLAIMED_TXNIDS_KEY,
  PAYU_COMPLETED_TXNID_KEY,
  recordPayuPaymentIssue,
} from "../../../../lib/payments/payu-payment-issues"

export type ProcessResult = {
  completed: boolean
  order_id: string | null
  reason?: string
}

export type ProcessDeps = {
  /** Re-verify a transaction with PayU. Injected in tests; defaults to verify_payment. */
  verifyTransaction?: (
    txnid: string,
    minAmount?: number
  ) => Promise<VerifyResult | null>
}

/**
 * @param payload the (hash-verified-or-not) webhook payload; must carry a
 *   success status, `udf1` (cart id) and `txnid`.
 */
export async function processPayuLinkWebhook(
  scope: any,
  payload: Record<string, any>,
  deps: ProcessDeps = {}
): Promise<ProcessResult> {
  const logger: any = scope.resolve(ContainerRegistrationKeys.LOGGER)
  const query = scope.resolve(ContainerRegistrationKeys.QUERY)
  const cartId = String(payload.udf1 || "")
  const txnid = String(payload.txnid || "")

  // A BALANCE link carries `balance:<schedule id>`, not a cart id: there is no
  // cart to complete, only an order's outstanding balance to settle.
  const balanceScheduleId = scheduleIdFromLinkRef(payload.udf1)
  if (balanceScheduleId) {
    const settled = await settlePayuBalance(scope, balanceScheduleId, payload, {
      verifyTransaction: deps.verifyTransaction,
    })
    return { completed: settled.settled, order_id: settled.order_id, reason: settled.reason }
  }

  if (!cartId) {
    return { completed: false, order_id: null, reason: "no_cart_id" }
  }

  const { data: carts } = await query.graph({
    entity: "cart",
    fields: [
      "id",
      "total",
      "completed_at",
      "metadata",
      "payment_collection.payment_sessions.data",
    ],
    filters: { id: cartId },
  })
  const cart = carts?.[0] as any
  if (!cart) {
    return { completed: false, order_id: null, reason: "cart_not_found" }
  }
  /**
   * The payment must cover what was DUE: the deposit on a quote cart (#1451),
   * the total otherwise. Checking against `cart.total` refused every paid
   * deposit link as "not verified".
   */
  let minAmount: number | undefined = cart.total ? Number(cart.total) : undefined
  try {
    const schedules: any = scope.resolve(PAYMENT_SCHEDULE_MODULE)
    const schedule = await schedules.findByCartId(cartId)
    const plan = planCartCollection({ cartTotal: cart.total, schedule })
    if (plan.basis !== "refuse" && Number.isFinite(plan.amount)) minAmount = plan.amount
  } catch {
    /* fall back to the cart total */
  }

  // 1) Primary re-verification: classic verify_payment (needs only key+salt+txnid).
  const verify =
    deps.verifyTransaction ??
    (async (id: string, min?: number) => {
      const key = process.env.PAYU_MERCHANT_KEY
      const salt = process.env.PAYU_MERCHANT_SALT
      if (!key || !salt || !id) return null
      return verifyPayuTransaction({
        key,
        salt,
        mode: process.env.PAYU_MODE,
        txnid: id,
        minAmount: min,
      })
    })

  let paid = false
  let verified: VerifyResult | null = null
  try {
    const v = await verify(txnid, minAmount)
    verified = v
    if (v?.paid) paid = true
    else if (v) {
      logger.warn(
        `[PayU Webhook] verify_payment says not-paid for txn ${txnid} (status=${v.status}, amount=${v.amount})`
      )
    }
  } catch (e: any) {
    logger.warn(`[PayU Webhook] verify_payment error for txn ${txnid}: ${e.message}`)
  }

  // 2) Fallback: OneAPI /payment-links/{invoice}/txns, if configured + invoice known.
  if (!paid) {
    const invoice = cart?.metadata?.payu_invoice_number
    const clientId = process.env.PAYU_CLIENT_ID
    const clientSecret = process.env.PAYU_CLIENT_SECRET
    const merchantId = process.env.PAYU_MERCHANT_ID
    if (clientId && clientSecret && merchantId && invoice) {
      try {
        const hosts = oneapiHosts(process.env.PAYU_ONEAPI_MODE)
        const tr = await fetch(hosts.token, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            grant_type: "client_credentials",
            client_id: clientId,
            client_secret: clientSecret,
            scope: "read_payment_links",
          }).toString(),
        })
        const tj: any = await tr.json().catch(() => ({}))
        if (tj.access_token) {
          const vr = await fetch(
            oneapiLinkTxnsUrl(process.env.PAYU_ONEAPI_MODE, String(invoice)),
            {
              headers: {
                Authorization: `Bearer ${tj.access_token}`,
                merchantId: String(merchantId),
              },
            }
          )
          const vj: any = await vr.json().catch(() => ({}))
          if (isLinkPaid(vj, minAmount ? Math.round(minAmount) : undefined).paid) {
            paid = true
          }
        }
      } catch (e: any) {
        logger.warn(`[PayU Webhook] OneAPI re-verify error for invoice ${invoice}: ${e.message}`)
      }
    }
  }

  const paidAmount =
    verified && Number.isFinite(Number(verified.amount)) ? Number(verified.amount) : null
  const mihpayid = payload.mihpayid ? String(payload.mihpayid) : null

  if (!paid) {
    /**
     * 🔴 #2572 — PayU says SUCCESS but for less than is due now: an old UPI QR
     * paid after a reprice or amend (an intent cannot be switched off). The
     * refusal is right, but the money is with us — never let it be silent.
     */
    if (verified?.status === "success" && paidAmount !== null) {
      await recordPayuPaymentIssue(scope, cartId, {
        kind: "short",
        txnid,
        mihpayid,
        paid: paidAmount,
        due: minAmount ?? null,
      })
      return { completed: false, order_id: null, reason: "paid_short" }
    }
    return { completed: false, order_id: null, reason: "not_verified" }
  }

  const cartService: any = scope.resolve(Modules.CART)
  const readFresh = async (): Promise<Record<string, any>> => {
    const [fresh] = await cartService.listCarts({ id: cartId }, { select: ["id", "metadata"] })
    return (fresh?.metadata ?? {}) as Record<string, any>
  }
  const knownTxnids = (metadata: Record<string, any>): unknown[] => [
    ...(Array.isArray(metadata[PAYU_CLAIMED_TXNIDS_KEY]) ? metadata[PAYU_CLAIMED_TXNIDS_KEY] : []),
    metadata[PAYU_COMPLETED_TXNID_KEY],
    // Carts completed before the stamps existed: the session carries it.
    ...((cart.payment_collection?.payment_sessions ?? []) as any[]).map((ps) => ps?.data?.txnid),
  ]
  const flagExtra = async () => {
    await recordPayuPaymentIssue(scope, cartId, {
      kind: "extra",
      txnid,
      mihpayid,
      paid: paidAmount,
      due: minAmount ?? null,
    })
    return { completed: false, order_id: null, reason: "extra_payment" } as ProcessResult
  }

  /**
   * 🔴 #2572 — a real payment for a cart that a DIFFERENT payment already
   * completed: the link and the UPI QR both paid, or checkout then QR.
   * Completion is idempotent and would swallow it without a word.
   *
   * PayU delivers the SAME payment's webhook more than once, ~1 s apart (seen
   * live 2026-11-22). So the txn is CLAIMED on the cart before completing:
   * any reader that can see `completed_at` can also see which txn did it, and
   * a duplicate is never mistaken for a second payment.
   */
  if (
    isExtraPayment({
      completedAt: cart.completed_at,
      knownTxnids: knownTxnids({ ...(cart.metadata ?? {}), ...(await readFresh().catch(() => ({}))) }),
      txnid,
    })
  ) {
    return flagExtra()
  }

  try {
    const fresh = await readFresh()
    const claimed: unknown[] = Array.isArray(fresh[PAYU_CLAIMED_TXNIDS_KEY])
      ? fresh[PAYU_CLAIMED_TXNIDS_KEY]
      : []
    if (!claimed.includes(txnid)) {
      await cartService.updateCarts(cartId, {
        metadata: { ...fresh, [PAYU_CLAIMED_TXNIDS_KEY]: [...claimed, txnid] },
      })
    }
  } catch (e: any) {
    logger.warn(`[PayU Webhook] could not claim txn ${txnid} on cart ${cartId}: ${e.message}`)
  }

  // Verified by PayU → complete the cart into an order (idempotent).
  const result = await completeCartFromExternalPayment(scope, cartId, {
    provider: "payu_link",
    txnid: payload.txnid,
    mihpayid: payload.mihpayid,
    mode: payload.mode,
    bank_ref_num: payload.bank_ref_num,
  })

  if (result.already_completed) {
    /**
     * Someone else completed it between our read and our completion. A repeat
     * of OUR payment claimed only our txn; a different payment's claim sitting
     * next to ours means this one is the second payment.
     */
    const fresh = await readFresh().catch(() => ({}) as Record<string, any>)
    const others = knownTxnids(fresh).filter(
      (t) => t !== null && t !== undefined && String(t) !== txnid
    )
    if (others.length) return flagExtra()
    return { completed: true, order_id: result.order_id }
  }

  // Remember which payment completed it.
  try {
    const fresh = await readFresh()
    await cartService.updateCarts(cartId, {
      metadata: { ...fresh, [PAYU_COMPLETED_TXNID_KEY]: txnid },
    })
  } catch (e: any) {
    logger.warn(`[PayU Webhook] could not stamp completing txn on cart ${cartId}: ${e.message}`)
  }

  // An old QR paid after the price went DOWN: completed, but overpaid.
  if (paidAmount !== null && minAmount !== undefined && paidAmount > minAmount + 1) {
    await recordPayuPaymentIssue(scope, cartId, {
      kind: "over",
      txnid,
      mihpayid,
      paid: paidAmount,
      due: minAmount,
    })
  }
  return { completed: true, order_id: result.order_id }
}
