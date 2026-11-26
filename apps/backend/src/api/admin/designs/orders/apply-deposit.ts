import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"

import { PAYMENT_SCHEDULE_MODULE } from "../../../../modules/payment_schedule"
import { decideDeposit, type DepositRefusal } from "./mutate-design-order"

/**
 * Put a deposit on a design order's cart: decide, clear an unpaid collection,
 * open (or replace) the payment schedule.
 *
 * Shared by `POST /admin/designs/orders/:lineItemId/deposit` (a deposit set
 * LATER) and `createDesignDraftOrder` (a deposit given at creation, #2645). One
 * function, so the two ways in cannot disagree about what a deposit is.
 *
 * ## Why create needs it BEFORE the link and the email
 *
 * The PayU link and the buyer email both price off the schedule
 * (`planCartCollection`). Created without one, the first link asks for the
 * full total and the first email quotes it: a buyer who pays it has paid in
 * full on an order the founder meant to take 50% on (#176's shape, on PayU).
 *
 * 🔴 A stale payment collection. If the buyer already opened checkout, the
 * cart holds a collection for the FULL total, and `ensureCartPaymentCollection`
 * refuses a deposit cart whose collection disagrees with its schedule. So an
 * unpaid collection is cleared here and checkout makes the right one next time.
 * A collection with any payment on it is refused instead: money was taken
 * against the full figure, and that needs a human, not a quiet delete.
 *
 * Never sends anything. Callers decide whether to mint a link and email.
 */

export type ApplyDepositInput = {
  lineItemId: string
  designId: string
  hasLinkedOrder: boolean
  depositPct?: unknown
  depositAmount?: unknown
  balanceTrigger?: unknown
  replace?: boolean
  setBy?: string | null
}

export type AppliedDeposit = {
  line_item_id: string
  cart_id: string
  schedule_id: string
  currency_code: string
  total_due: number
  deposit_pct: number | null
  deposit_amount: number
  balance_amount: number
  balance_trigger: string
  cleared_payment_collection_id: string | null
  replaced_schedule: boolean
}

export type ApplyDepositResult =
  | { ok: true; deposit: AppliedDeposit }
  | {
      ok: false
      /** The HTTP status the deposit route has always answered with. */
      status: number
      reason: DepositRefusal | "collection_has_payments"
      message: string
    }

const VALIDATION_REASONS: ReadonlySet<string> = new Set([
  "not_a_pct",
  "not_an_amount",
  "pct_and_amount",
  "bad_balance_trigger",
  "no_total",
])

/** PURE: the status code a refusal maps to — unchanged from the route. */
export const depositRefusalStatus = (reason: string): number =>
  reason === "no_cart" ? 404 : VALIDATION_REASONS.has(reason) ? 400 : 409

export async function applyDesignOrderDeposit(
  scope: any,
  input: ApplyDepositInput
): Promise<ApplyDepositResult> {
  const logger: any = scope.resolve(ContainerRegistrationKeys.LOGGER)
  const query: any = scope.resolve(ContainerRegistrationKeys.QUERY)
  const cartService: any = scope.resolve(Modules.CART)
  const schedules: any = scope.resolve(PAYMENT_SCHEDULE_MODULE)
  const { lineItemId } = input

  const [lineItem] = await cartService.listLineItems(
    { id: lineItemId },
    { select: ["id", "cart_id"] }
  )
  // query.graph, not retrieveCart: only the graph computes `total`.
  const cart = lineItem?.cart_id
    ? (
        await query.graph({
          entity: "cart",
          fields: [
            "id",
            "currency_code",
            "total",
            "completed_at",
            "metadata",
            "payment_collection.id",
            "payment_collection.amount",
            "payment_collection.payments.id",
          ],
          filters: { id: lineItem.cart_id },
        })
      ).data?.[0] ?? null
    : null

  const existing = cart ? await schedules.findByCartId(cart.id) : null
  const decision = decideDeposit({
    cart,
    depositPct: input.depositPct,
    depositAmount: input.depositAmount,
    balanceTrigger: input.balanceTrigger,
    hasLinkedOrder: input.hasLinkedOrder,
    hasSchedule: Boolean(existing),
    replace: input.replace === true,
    existingSchedule: existing,
  })

  if (!decision.ok) {
    return {
      ok: false,
      status: depositRefusalStatus(decision.reason),
      reason: decision.reason,
      message: decision.message,
    }
  }

  const collection = cart.payment_collection
  let clearedCollectionId: string | null = null
  if (collection?.id) {
    if ((collection.payments ?? []).length) {
      return {
        ok: false,
        status: 409,
        reason: "collection_has_payments",
        message:
          `The buyer's checkout already holds a payment against payment collection ${collection.id}. ` +
          "Resolve that payment before putting a deposit on this order.",
      }
    }
    const link: any = scope.resolve(ContainerRegistrationKeys.LINK)
    await link.dismiss([
      {
        [Modules.CART]: { cart_id: cart.id },
        [Modules.PAYMENT]: { payment_collection_id: collection.id },
      },
    ])
    await (scope.resolve(Modules.PAYMENT) as any).deletePaymentCollections([collection.id])
    clearedCollectionId = collection.id
  }

  const setBy = input.setBy ?? null
  const schedule = decision.replaces_schedule
    ? await schedules.replaceManualDeposit(existing.id, {
        total_due: decision.total_due,
        quote_deposit_pct: decision.deposit_pct,
        fixed_deposit_amount: decision.deposit_amount,
        balance_trigger: decision.balance_trigger,
        metadata: {
          set_by: setBy,
          replaced: {
            deposit_pct: existing.deposit_pct ?? null,
            deposit_amount: Number(existing.deposit_amount),
          },
        },
      })
    : await schedules.openForCart({
        cart_id: cart.id,
        currency_code: cart.currency_code,
        total_due: decision.total_due,
        source_type: "manual",
        source_id: lineItemId,
        // Same rail rule as accept-quote: PayU is INR-only.
        rail: String(cart.currency_code).toLowerCase() === "inr" ? "payu" : "stripe",
        quote_deposit_pct: decision.deposit_pct,
        fixed_deposit_amount: decision.deposit_amount,
        balance_trigger: decision.balance_trigger,
        metadata: {
          design_id: input.designId,
          set_by: setBy,
        },
      })

  logger?.info?.(
    `[deposit] design order ${lineItemId} (cart ${cart.id}): ` +
      `${schedule.deposit_pct == null ? "fixed" : `${schedule.deposit_pct}%`} = ` +
      `${schedule.deposit_amount} of ${decision.total_due} ${String(cart.currency_code).toUpperCase()}` +
      (clearedCollectionId ? `; cleared unpaid collection ${clearedCollectionId}` : "")
  )

  return {
    ok: true,
    deposit: {
      line_item_id: lineItemId,
      cart_id: cart.id,
      schedule_id: schedule.id,
      currency_code: cart.currency_code,
      total_due: decision.total_due,
      deposit_pct: schedule.deposit_pct == null ? null : Number(schedule.deposit_pct),
      deposit_amount: Number(schedule.deposit_amount),
      balance_amount: Number(schedule.balance_amount),
      balance_trigger: schedule.balance_trigger,
      cleared_payment_collection_id: clearedCollectionId,
      replaced_schedule: decision.replaces_schedule,
    },
  }
}
