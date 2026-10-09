import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { markPaymentCollectionAsPaid } from "@medusajs/core-flows"

import { PAYMENT_SCHEDULE_MODULE } from "../../modules/payment_schedule"
import { createPayuLink } from "../../api/admin/lib/create-payu-link"
import {
  verifyPayuTransaction,
  type VerifyResult,
} from "../../api/store/payu/lib/verify-payment"
import { pickOutstandingBalanceCollection } from "./reconcile-balance"

/**
 * The BALANCE of an INR deal, collected over PayU.
 *
 * Until this, a quote whose deposit was taken by PayU had its balance sent to
 * a Stripe card page — an Indian buyer paid 10% by UPI and was then asked for
 * 90% by card. The deposit rail is a cart completing into an order; the
 * balance has no cart, so it cannot reuse the cart-completing webhook as is.
 *
 * The link carries `balance:<schedule id>` in `udf1` (where a cart link
 * carries the cart id), and the link webhook branches on that prefix.
 */
export const BALANCE_LINK_PREFIX = "balance:"

export const balanceLinkRef = (scheduleId: string): string =>
  `${BALANCE_LINK_PREFIX}${scheduleId}`

/** The schedule id a webhook's `udf1` points at, or null when it is not a balance link. */
export const scheduleIdFromLinkRef = (udf1: unknown): string | null => {
  const s = String(udf1 ?? "")
  if (!s.startsWith(BALANCE_LINK_PREFIX)) return null
  const id = s.slice(BALANCE_LINK_PREFIX.length).trim()
  return id || null
}

/**
 * Mint a PayU link for a raised balance. Returns null when PayU is not
 * configured or refuses: the caller then falls back to the Stripe balance
 * page, which still collects the money, rather than leaving the buyer with no
 * way to pay at all.
 */
export async function createPayuBalanceLink(
  container: any,
  input: {
    schedule_id: string
    order_id: string
    amount: number
  }
): Promise<string | null> {
  const logger: any = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query: any = container.resolve(ContainerRegistrationKeys.QUERY)

  let customer: { name?: string; email?: string; mobileNumber?: string } | undefined
  let displayId: string | number | null = null
  try {
    const { data } = await query.graph({
      entity: "order",
      fields: [
        "id",
        "display_id",
        "email",
        "billing_address.first_name",
        "billing_address.last_name",
        "billing_address.phone",
        "shipping_address.phone",
      ],
      filters: { id: input.order_id },
    })
    const o = data?.[0] as any
    displayId = o?.display_id ?? null
    const name = [o?.billing_address?.first_name, o?.billing_address?.last_name]
      .filter(Boolean)
      .join(" ")
    customer = {
      name: name || undefined,
      email: o?.email || undefined,
      mobileNumber:
        o?.billing_address?.phone || o?.shipping_address?.phone || undefined,
    }
  } catch {
    /* a link without customer details is still a link */
  }

  const created = await createPayuLink(
    {
      amount: input.amount,
      description: displayId
        ? `Balance for order #${displayId}`
        : "Order balance",
      customer,
      reference: balanceLinkRef(input.schedule_id),
    },
    logger
  )

  if (!created.payment_link) {
    logger?.warn?.(
      `[balance] PayU link for schedule=${input.schedule_id} not created (${
        created.error ?? "no link"
      }) — falling back to the Stripe balance page`
    )
    return null
  }
  return created.payment_link
}

export type PayuBalanceResult = {
  settled: boolean
  schedule_id: string
  order_id: string | null
  reason: string
}

export type PayuBalanceDeps = {
  /** Re-verify a transaction with PayU. Injected in tests. */
  verifyTransaction?: (txnid: string, minAmount?: number) => Promise<VerifyResult | null>
}

/**
 * A PayU balance link was paid: verify it WITH PayU, then record the money on
 * the order and the schedule.
 *
 * Same gate as the cart rail: the inbound webhook is not trusted, PayU is
 * re-queried for the transaction and must confirm at least the balance amount.
 *
 * Recording uses core's `markPaymentCollectionAsPaid`, which captures a
 * payment on the outstanding collection, so the ORDER stops reporting a
 * pending difference; then the schedule is marked paid with PayU's txnid.
 * Idempotent: a repeated webhook for a paid balance changes nothing.
 */
export async function settlePayuBalance(
  scope: any,
  scheduleId: string,
  payload: Record<string, any>,
  deps: PayuBalanceDeps = {}
): Promise<PayuBalanceResult> {
  const logger: any = scope.resolve(ContainerRegistrationKeys.LOGGER)
  const query: any = scope.resolve(ContainerRegistrationKeys.QUERY)
  const schedules: any = scope.resolve(PAYMENT_SCHEDULE_MODULE)
  const txnid = String(payload.txnid || "")

  let schedule: any
  try {
    schedule = await schedules.retrievePaymentSchedule(scheduleId)
  } catch {
    return { settled: false, schedule_id: scheduleId, order_id: null, reason: "schedule_not_found" }
  }
  const orderId: string | null = schedule.order_id ?? null

  if (schedule.balance_status === "paid") {
    return { settled: true, schedule_id: scheduleId, order_id: orderId, reason: "already_paid" }
  }
  if (!orderId) {
    return { settled: false, schedule_id: scheduleId, order_id: null, reason: "no_order" }
  }
  if (schedule.balance_status !== "due") {
    // A payment for a balance nobody raised. Do not invent a debt to settle.
    logger?.warn?.(
      `[balance] PayU webhook for schedule=${scheduleId} whose balance is ${schedule.balance_status}; not settling`
    )
    return { settled: false, schedule_id: scheduleId, order_id: orderId, reason: "balance_not_due" }
  }

  const expected = Number(schedule.balance_amount)
  const verify =
    deps.verifyTransaction ??
    (async (id: string, min?: number) => {
      const key = process.env.PAYU_MERCHANT_KEY
      const salt = process.env.PAYU_MERCHANT_SALT
      if (!key || !salt || !id) return null
      return verifyPayuTransaction({ key, salt, mode: process.env.PAYU_MODE, txnid: id, minAmount: min })
    })

  let paid = false
  try {
    const v = await verify(txnid, Number.isFinite(expected) ? expected : undefined)
    paid = !!v?.paid
    if (!paid && v) {
      logger?.warn?.(
        `[balance] PayU says txn ${txnid} is not paid (status=${v.status}, amount=${v.amount}) for schedule=${scheduleId}`
      )
    }
  } catch (e: any) {
    logger?.warn?.(`[balance] PayU verify error for txn ${txnid}: ${e?.message ?? e}`)
  }
  if (!paid) {
    return { settled: false, schedule_id: scheduleId, order_id: orderId, reason: "not_verified" }
  }

  const { data: orders } = await query.graph({
    entity: "order",
    fields: [
      "id",
      "payment_collections.id",
      "payment_collections.amount",
      "payment_collections.status",
    ],
    filters: { id: orderId },
  })
  const collections = ((orders?.[0] as any)?.payment_collections ?? []) as any[]
  const collection = pickOutstandingBalanceCollection(collections, expected)

  if (collection) {
    await markPaymentCollectionAsPaid(scope).run({
      input: {
        order_id: orderId,
        payment_collection_id: collection.id,
        captured_by: "payu_link",
      },
    })
  } else {
    // PayU has the money but the order shows no outstanding collection. Record
    // the schedule (the money is real) and say so loudly for reconciliation.
    logger?.warn?.(
      `[balance] PayU paid schedule=${scheduleId} but order=${orderId} has no outstanding collection; schedule marked paid, order needs a look`
    )
  }

  await schedules.markBalancePaid(scheduleId, txnid || null)
  logger?.info?.(
    `[balance] schedule=${scheduleId} order=${orderId} PAID over PayU — txn ${txnid}, ${expected}`
  )
  return { settled: true, schedule_id: scheduleId, order_id: orderId, reason: "paid" }
}
