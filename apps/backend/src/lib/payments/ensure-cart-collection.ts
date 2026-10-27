import { ContainerRegistrationKeys, MedusaError, Modules } from "@medusajs/framework/utils"
import type { Link } from "@medusajs/framework/modules-sdk"
import {
  createPaymentCollectionForCartWorkflow,
  deletePaymentSessionsWorkflow,
  refreshPaymentCollectionForCartWorkflow,
} from "@medusajs/medusa/core-flows"

import { PAYMENT_SCHEDULE_MODULE } from "../../modules/payment_schedule"
import { assertCollectable, planCartCollection, type CollectionPlan } from "./deposit-collection"

/**
 * Ensure a cart has a payment collection for the RIGHT amount (#1451).
 *
 * Both payment rails carried the same block:
 *
 *     let pcId = cart.payment_collection?.id
 *     if (!pcId) {
 *       const { result } = await createPaymentCollectionForCartWorkflow(scope)
 *         .run({ input: { cart_id: cartId } })
 *       pcId = result.id
 *     }
 *
 * — and core's workflow hardcodes `amount: cart.raw_total`. There is no
 * override, so a deposit could not be expressed through it at all. This
 * replaces that block in both places, so the amount decision has exactly one
 * home (`planCartCollection`) and the two rails cannot drift apart about what a
 * deposit is.
 *
 * The full-total path still runs core's workflow untouched: ordinary carts are
 * the overwhelming majority and must not start taking a bespoke code path to
 * get the behaviour they already had.
 */
export async function ensureCartPaymentCollection(
  scope: any,
  cart: {
    id: string
    currency_code?: string | null
    total?: number | string | null
    payment_collection?: { id?: string; amount?: number | string | null } | null
  }
): Promise<{ id: string; plan: CollectionPlan }> {
  const schedules: any = scope.resolve(PAYMENT_SCHEDULE_MODULE)
  const schedule = await schedules.findByCartId(cart.id)

  const plan = planCartCollection({
    cartTotal: cart.total,
    cartCurrency: cart.currency_code,
    schedule,
  })
  assertCollectable(plan)

  const existingId = cart.payment_collection?.id
  if (existingId) {
    /**
     * 🔴 An existing collection is NOT automatically the right one.
     *
     * The three quote carts on prod when this shipped were created before the
     * deposit was wired, so their collections — if any rail had made one —
     * carry the full total. Silently reusing one would charge exactly the
     * amount this change exists to stop.
     *
     * So: reuse it when it agrees with the plan, and refuse loudly when it does
     * not. Refusing is recoverable (delete the collection, re-enter checkout);
     * charging the wrong number is not. The comparison is to the cent because
     * these are decimal money values, not floats-with-hope.
     */
    const existingAmount = Number(cart.payment_collection?.amount)
    const differs =
      plan.basis === "deposit" &&
      Number.isFinite(existingAmount) &&
      Math.round(existingAmount * 100) !== Math.round(plan.amount * 100)
    /**
     * A MANUAL deposit follows the cart total, so its collection going stale
     * is expected — the buyer added an address and GST applied. Re-align it
     * the way core re-aligns an ordinary cart's collection. A quote's deposit
     * is fixed at mint, so a mismatch there still means something is wrong.
     */
    if (differs && schedule?.source_type === "manual") {
      await alignManualDepositCollection(scope, cart.payment_collection as any, plan.amount, cart.id)
      return { id: existingId, plan }
    }
    if (differs) {
      throw new MedusaError(
        MedusaError.Types.NOT_ALLOWED,
        `Cart ${cart.id} already has a payment collection for ${existingAmount}, but its payment schedule says ${plan.amount} is due now. ` +
          `Refusing rather than charging either figure — clear the stale payment collection and re-enter checkout.`
      )
    }
    return { id: existingId, plan }
  }

  if (plan.basis === "full") {
    const { result } = await createPaymentCollectionForCartWorkflow(scope).run({
      input: { cart_id: cart.id },
    })
    return { id: (result as any).id, plan }
  }

  /**
   * The deposit path. Core's workflow cannot express this, so the collection is
   * created directly and linked to the cart the same way core links it — the
   * link is what makes `cart.payment_collection` resolve, and without it the
   * rail would create a second collection on the next request.
   */
  const paymentService: any = scope.resolve(Modules.PAYMENT)
  const created = await paymentService.createPaymentCollections([
    {
      currency_code: cart.currency_code,
      amount: plan.amount,
    },
  ])
  const collection = Array.isArray(created) ? created[0] : created

  const link: Link = scope.resolve(ContainerRegistrationKeys.LINK)
  await link.create([
    {
      [Modules.CART]: { cart_id: cart.id },
      [Modules.PAYMENT]: { payment_collection_id: collection.id },
    },
  ])

  const logger: any = scope.resolve(ContainerRegistrationKeys.LOGGER)
  // Deliberately `info` and always on: this is the line that says a buyer was
  // asked for a part payment rather than the whole thing, and it is the first
  // place anyone will look when a figure is questioned.
  logger?.info?.(
    `[deposit] cart=${cart.id} collecting ${plan.amount} ${String(cart.currency_code).toUpperCase()} of ${cart.total} — ${plan.reason}`
  )

  return { id: collection.id, plan }
}

/**
 * Refresh a cart's payment sessions WITHOUT resetting a deposit to the full
 * total (#1451).
 *
 * 🔴 This is the trap that would have silently undone the whole change.
 *
 * Core's `refreshPaymentCollectionForCartWorkflow` compares the collection's
 * `raw_amount` to `cart.raw_total` and, when they differ, deletes every session
 * AND updates the collection to `amount: cart.raw_total`. A deposit collection
 * differs from the cart total BY DEFINITION, so every refresh resets it to
 * 100%. Medusa's own docs say so plainly — the complete-cart workflow "relies
 * on the amount set during the payment collection's creation *or last
 * refresh*".
 *
 * The PayU rail refreshes in five places (the retry route, and four call sites
 * in the complete route), so a buyer who retried a failed payment would have
 * been asked for the full total with nothing in the logs to show why. The fix
 * charges correctly and the retry charges wrong — worse than not shipping,
 * because it looks fixed.
 *
 * So on a deposit cart we do the HALF of refresh that is wanted — dropping the
 * stale sessions so a fresh one can be created — and leave the amount alone.
 * Every other cart still goes through core's workflow untouched.
 */
export async function refreshCartPaymentCollection(
  scope: any,
  cart: {
    id: string
    currency_code?: string | null
    total?: number | string | null
    payment_collection?: {
      id?: string
      amount?: number | string | null
      payment_sessions?: Array<{ id: string }> | null
    } | null
  }
): Promise<{ preserved_deposit: boolean; plan: CollectionPlan }> {
  const schedules: any = scope.resolve(PAYMENT_SCHEDULE_MODULE)
  const schedule = await schedules.findByCartId(cart.id)

  const plan = planCartCollection({
    cartTotal: cart.total,
    cartCurrency: cart.currency_code,
    schedule,
  })

  /**
   * A refusal here is NOT re-thrown. Refresh runs on retry and completion
   * paths, often inside a catch — turning a "this deposit looks wrong" into a
   * thrown error there would replace a recoverable payment retry with a dead
   * checkout. The refusal will be raised by `ensureCartPaymentCollection` at
   * the point a charge is actually about to be created, which is where it
   * belongs. Here we only decide whether to protect the amount.
   */
  if (plan.basis !== "deposit") {
    await refreshPaymentCollectionForCartWorkflow(scope).run({
      input: { cart_id: cart.id },
    })
    return { preserved_deposit: false, plan }
  }

  const ids = (cart.payment_collection?.payment_sessions ?? [])
    .map((s) => s?.id)
    .filter(Boolean) as string[]

  if (ids.length) {
    await deletePaymentSessionsWorkflow(scope).run({ input: { ids } })
  }

  // A manual deposit follows the cart total; keep its collection in step.
  const collectionAmount = Number(cart.payment_collection?.amount)
  if (
    schedule?.source_type === "manual" &&
    cart.payment_collection?.id &&
    Number.isFinite(collectionAmount) &&
    Math.round(collectionAmount * 100) !== Math.round(plan.amount * 100)
  ) {
    await alignManualDepositCollection(scope, { id: cart.payment_collection.id }, plan.amount, cart.id)
  }

  const logger: any = scope.resolve(ContainerRegistrationKeys.LOGGER)
  logger?.info?.(
    `[deposit] cart=${cart.id} refreshed ${ids.length} session(s), PRESERVING the deposit amount ${plan.amount} — core's refresh would have reset it to the cart total.`
  )

  return { preserved_deposit: true, plan }
}

/**
 * Set a manual deposit's collection to the amount the plan says is due now,
 * dropping any sessions priced at the old amount so the rail opens a fresh one.
 *
 * Only an UNPAID collection is touched: once money has landed on it, a figure
 * changing underneath is a reconciliation for a human, not something to fix
 * quietly here — so that case throws, like the quote path's mismatch does.
 */
async function alignManualDepositCollection(
  scope: any,
  collection: { id: string; payment_sessions?: Array<{ id: string }> | null },
  amount: number,
  cartId: string
): Promise<void> {
  const query: any = scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "payment_collection",
    fields: ["id", "amount", "payments.id", "payment_sessions.id"],
    filters: { id: collection.id },
  })
  const current = data?.[0]
  if ((current?.payments ?? []).length) {
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      `Cart ${cartId}'s payment collection ${collection.id} already holds a payment, so its deposit cannot be re-aligned to ${amount}. Reconcile it by hand.`
    )
  }
  const sessionIds = (current?.payment_sessions ?? []).map((s: any) => s.id).filter(Boolean)
  if (sessionIds.length) {
    await deletePaymentSessionsWorkflow(scope).run({ input: { ids: sessionIds } })
  }
  await (scope.resolve(Modules.PAYMENT) as any).updatePaymentCollections(collection.id, { amount })

  const logger: any = scope.resolve(ContainerRegistrationKeys.LOGGER)
  logger?.info?.(
    `[deposit] cart=${cartId} manual deposit collection ${collection.id} re-aligned to ${amount} (cart total changed)`
  )
}
