import { MedusaError, Modules } from "@medusajs/framework/utils"

import { evaluateCartCourierCod } from "./cart-courier-cod"
import { courierCodRefusalMessage, isCodProvider } from "./courier-cod"

/**
 * Cash on delivery by courier, enforced on the server (founder, 2026-11-27).
 *
 * The storefront only OFFERS cash where the delivery check allows it; a buyer
 * can still pick the cash provider through the store API directly. So when a
 * cart is about to complete on the cash provider (`pp_system_default`) with a
 * courier delivery, the rule is checked again from the database and a fresh
 * Delhivery lookup. Pickup carts keep paying cash as before.
 *
 * Called from the single `completeCartWorkflow.hooks.validate` handler
 * (Medusa allows one handler per hook — see
 * `workflows/hooks/block-cancelled-design-order-checkout.ts`). `validate` runs
 * before payment authorization, so refusing takes no money and creates no
 * order.
 *
 * The one exemption is a cart being completed from a PAID PayU link that fell
 * back to the cash provider (`complete-from-external.ts`): its session carries
 * `external_payment`, which only that server code sets (the store
 * payment-sessions route strips it from buyer data).
 *
 * The outcome is recorded on the cart (`cod_collect`) for the order stamp.
 */

const ACTIVE = new Set(["pending", "requires_more", "authorized"])

/** The cart's live cash-provider session, or null. */
export function cashSessionOf(cart: any): any | null {
  const sessions: any[] = cart?.payment_collection?.payment_sessions ?? []
  return (
    sessions.find(
      (s) => isCodProvider(s?.provider_id) && (!s?.status || ACTIVE.has(String(s.status)))
    ) ?? null
  )
}

/**
 * Cart metadata key recording, at completion, whether the courier must
 * collect. Written here (always, on a cash cart, overwriting anything the
 * buyer put there) and read by the `order.placed` stamp — the session's own
 * data can't carry it, because authorizing replaces it with the provider's
 * `{}`.
 */
export const COD_COLLECT_KEY = "cod_collect"

export async function assertCourierCodAllowed(cart: any, container: any): Promise<void> {
  const session = cashSessionOf(cart)
  if (!session) return

  const record = async (collect: boolean) => {
    const cartModule: any = container.resolve(Modules.CART)
    await cartModule.updateCarts(cart.id, {
      metadata: { ...(cart.metadata ?? {}), [COD_COLLECT_KEY]: collect },
    })
  }

  if (session?.data?.external_payment) {
    await record(false)
    return
  }

  const evaluated = await evaluateCartCourierCod(container, cart.id)
  if (!evaluated || !evaluated.is_courier) {
    await record(false)
    return
  }

  if (!evaluated.decision.allowed) {
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      courierCodRefusalMessage(evaluated.decision)
    )
  }
  await record(true)
}
