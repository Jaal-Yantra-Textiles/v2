import { Modules } from "@medusajs/framework/utils"
import { refreshPaymentCollectionForCartWorkflow } from "@medusajs/medusa/core-flows"

import { COD_FEE_DATA_KEY, evaluateCartCourierCod } from "./cart-courier-cod"
import { courierCodFee, isCodProvider } from "./courier-cod"

/**
 * The ₹200 COD fee (founder, 2026-11-27) on a courier cash order.
 *
 * It is ADDED TO THE COURIER SHIPPING METHOD's amount (recorded as
 * `data.cod_fee`), which is what makes the founder's rules hold without any
 * new tax or order plumbing:
 *  - taxed exactly as shipping is: the method's own tax lines and
 *    tax-inclusive setting apply to it;
 *  - in the order total, so the courier collects it (the shipment books the
 *    order total as the COD amount);
 *  - not an item, so nothing about fulfilment, stock or invoicing lines sees a
 *    phantom product.
 *
 * Applied when the buyer opens a CASH session on a courier cart that may pay
 * cash, removed when they open any other session (or cash is no longer
 * allowed). Both happen in the store payment-sessions route, BEFORE the
 * session is created, so the session is opened for the right total.
 *
 * Returns true when the cart's total changed (the caller must refresh the
 * payment collection).
 */
export async function syncCodFeeForSession(
  scope: any,
  cartId: string,
  providerId: string
): Promise<boolean> {
  // Not cash → the fee comes off whatever Delhivery says; don't ask it.
  const evaluated = await evaluateCartCourierCod(
    scope,
    cartId,
    isCodProvider(providerId) ? {} : { delhiveryCod: true }
  )
  const method = evaluated?.courier_method
  if (!evaluated || !method) return false

  const want =
    isCodProvider(providerId) && evaluated.is_courier && evaluated.decision.allowed
      ? courierCodFee()
      : 0
  if (method.cod_fee === want) return false

  const cartModule: any = scope.resolve(Modules.CART)
  await cartModule.updateShippingMethods([
    {
      id: method.id,
      amount: Math.max(0, method.amount - method.cod_fee + want),
      data: { ...method.data, [COD_FEE_DATA_KEY]: want },
    },
  ])
  // The collection was sized for the old total; re-size it (this also drops
  // stale sessions, and the caller is about to create the new one).
  await refreshPaymentCollectionForCartWorkflow(scope).run({ input: { cart_id: cartId } })
  return true
}
