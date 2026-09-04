import {
  MedusaRequest,
  MedusaResponse,
  refetchEntity,
} from "@medusajs/framework/http"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"

import { ensureCartPaymentCollection } from "../../../lib/payments/ensure-cart-collection"

const DEFAULT_FIELDS = ["id", "currency_code", "amount", "*payment_sessions"]

/**
 * Override of the core store payment-collection route
 * (POST /store/payment-collections).
 *
 * ## Why this exists — the third door (#1787)
 *
 * #1451 established that a deposit cannot be expressed through core's
 * `createPaymentCollectionForCartWorkflow`, which hardcodes
 * `amount: cart.raw_total`, and replaced it with `ensureCartPaymentCollection`
 * — in the two places that were known to create a collection: the hosted Stripe
 * payment page and the PayU rail.
 *
 * 🔴 It was never fixed at the door the ORDINARY STOREFRONT CHECKOUT uses. The
 * starter's `initiatePaymentSession` calls `sdk.store.payment
 * .initiatePaymentSession(cart, …)`, which POSTs here first to make the
 * collection, and only then creates the session. There was no route file under
 * `api/store/payment-collections/`, so that POST fell through to core and every
 * quote cart entering checkout the normal way had a collection minted for the
 * FULL total.
 *
 * The buyer-visible symptom is exactly what was reported on a live AUD quote:
 * the checkout shows no "Pay now (deposit)" line and asks for the whole amount.
 * The storefront's `Review` panel derives that line from
 * `payment_collection.amount < cart.total`, so a full-total collection does not
 * render a broken deposit — it renders no deposit at all, which reads like a
 * product decision rather than a defect.
 *
 * ⚠️ Two green rails are not a covered money path. The deposit was verified end
 * to end on the hosted page and on PayU, and the conclusion drawn was that "the
 * deposit works". Both verifications went through the two doors that had been
 * fixed. Enumerate the callers of the thing you replaced, not the ones you
 * remember replacing.
 *
 * ## Behaviour
 *
 * Identical to core for an ordinary cart: `planCartCollection` returns a `full`
 * basis and `ensureCartPaymentCollection` runs core's own workflow untouched.
 * Only a cart carrying a payment schedule with a usable deposit takes the
 * bespoke path, and that path refuses rather than guesses (see
 * `deposit-collection.ts`).
 */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const body = (req as any).validatedBody ?? req.body ?? {}
  const cartId = String((body as { cart_id?: string }).cart_id || "")

  if (!cartId) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "cart_id is required to create a payment collection"
    )
  }

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  const { data } = await query.graph({
    entity: "cart",
    fields: [
      "id",
      "completed_at",
      "currency_code",
      "total",
      "payment_collection.id",
      // The seam refuses to reuse a collection whose amount disagrees with the
      // schedule, so it must be able to see the amount (#1451).
      "payment_collection.amount",
    ],
    filters: { id: cartId },
  })

  const cart = data?.[0] as any

  if (!cart) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, `Cart ${cartId} not found`)
  }

  /**
   * Core does not check this here, but minting a collection against a completed
   * cart can only lead to a second charge on an order that is already paid.
   */
  if (cart.completed_at) {
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      `Cart ${cartId} is already completed`
    )
  }

  const { id } = await ensureCartPaymentCollection(req.scope, cart)

  const paymentCollection = await refetchEntity({
    entity: "payment_collection",
    idOrFilter: id,
    scope: req.scope,
    fields: req.queryConfig?.fields ?? DEFAULT_FIELDS,
  })

  res.status(200).json({ payment_collection: paymentCollection })
}
