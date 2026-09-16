/**
 * The rules for changing a design order that ALREADY exists.
 *
 * A design order is a CART with custom-priced design line items
 * (`create-draft-order-from-designs`). Everything about it was decided at
 * creation and nothing could change afterwards, because no admin route could
 * mutate a cart — Medusa's cart mutations are store-side. So an order created
 * without a buyer stayed buyer-less, and a price agreed after the fact could
 * not be recorded. #1970 PR5.
 *
 * ## 🔴 A customer lives in TWO places, and they can disagree
 *
 * The design-order detail route reads the buyer from three sources in order:
 * the design↔customer LINK first, then `cart.customer_id`, then the converted
 * order's customer. Writing only one of the first two leaves the other stale:
 *
 * - link only → the admin screen shows a buyer, while checkout still has a
 *   cart with `customer_id: null` and `email: null`, so nothing can be sent to
 *   them and the order completes anonymous.
 * - cart only → checkout is right, but every reader that goes through the link
 *   (the design pages, the status emails) still says nobody owns this design.
 *
 * That is the shape of #1946 — one surface writing one side of a pair while
 * another surface reads the other. So an attach writes BOTH, and these
 * functions decide what both writes should be before either is attempted.
 *
 * Pure on purpose: the decision is testable without a cart, a container, or a
 * link module.
 */

export type DesignOrderCart = {
  id: string
  customer_id?: string | null
  email?: string | null
  /** Set once the cart has been converted — the ORDER is the record after that. */
  completed_at?: string | Date | null
}

export type AttachCustomerRefusal =
  | "cart_completed"
  | "no_cart"
  | "customer_not_found"

export type AttachCustomerDecision =
  | {
      ok: true
      /** Already true in both places — write nothing, report it as a no-op. */
      noop: boolean
      cart: { customer_id: string | null; email: string | null }
      /** design↔customer links to create. Empty when one already exists. */
      link: { design_id: string; customer_id: string } | null
      /**
       * Links to OTHER customers that must go.
       *
       * `design-customer-link` is `isList: true` on both sides, so attaching
       * without dismissing accumulates buyers and the detail route then shows
       * `[0]` — whichever the database returns first. A design order has one
       * buyer; "several, pick one" is how a stranger's name ends up on it.
       */
      dismiss: Array<{ design_id: string; customer_id: string }>
    }
  | { ok: false; reason: AttachCustomerRefusal; message: string }

export function decideCustomerAttach(input: {
  designId: string
  cart: DesignOrderCart | null | undefined
  /** Every customer currently linked to this design. */
  linkedCustomerIds: string[]
  /** The customer to attach, already verified to exist. `null` detaches. */
  customer: { id: string; email?: string | null } | null
}): AttachCustomerDecision {
  const { designId, cart, linkedCustomerIds, customer } = input

  if (!cart) {
    return {
      ok: false,
      reason: "no_cart",
      message:
        "This design order has no cart — there is nothing to attach a customer to.",
    }
  }

  /**
   * 🔴 A completed cart is history. Its order already carries a customer (or
   * deliberately does not), and rewriting the cart now would change neither
   * the order nor anything a buyer sees — it would only make the admin screen
   * disagree with the order. Repair the ORDER instead.
   */
  if (cart.completed_at) {
    return {
      ok: false,
      reason: "cart_completed",
      message:
        `This design order has already been converted to an order, so its cart ` +
        `can no longer be changed. Change the customer on the order itself.`,
    }
  }

  const targetId = customer?.id ?? null
  // `?? null`, not `|| null`: preserved so an empty-string email is normalised
  // to null rather than written as a present-but-unreachable address.
  const targetEmail = customer?.email?.trim() ? customer.email.trim() : null

  const stale = [...new Set(linkedCustomerIds)].filter((id) => id !== targetId)
  const linkAlreadyRight = targetId !== null && linkedCustomerIds.includes(targetId)
  const cartAlreadyRight =
    (cart.customer_id ?? null) === targetId && (cart.email ?? null) === targetEmail

  return {
    ok: true,
    noop: cartAlreadyRight && linkAlreadyRight && stale.length === 0,
    cart: { customer_id: targetId, email: targetEmail },
    link: targetId && !linkAlreadyRight ? { design_id: designId, customer_id: targetId } : null,
    dismiss: stale.map((customer_id) => ({ design_id: designId, customer_id })),
  }
}

export type RepriceRefusal = "cart_completed" | "no_cart" | "not_a_price" | "unchanged"

export type RepriceDecision =
  | { ok: true; unit_price: number; previous: number | null }
  | { ok: false; reason: RepriceRefusal; message: string }

/**
 * A new custom price on an existing design line.
 *
 * The line is already `is_custom_price: true`, so nothing recalculates it —
 * which is exactly why it can be set safely, and exactly why nothing else
 * will ever correct a wrong one.
 */
export function decideReprice(input: {
  cart: DesignOrderCart | null | undefined
  currentUnitPrice: number | null | undefined
  unitPrice: unknown
}): RepriceDecision {
  const { cart, currentUnitPrice } = input

  if (!cart) {
    return { ok: false, reason: "no_cart", message: "This design order has no cart." }
  }
  if (cart.completed_at) {
    return {
      ok: false,
      reason: "cart_completed",
      message:
        "This design order has already been converted to an order. Reprice it " +
        "through an order edit, not the cart.",
    }
  }

  const next = Number(input.unitPrice)
  /**
   * 🔴 `> 0`, never `!= null`. `Number(null)` is 0 and `Number("")` is 0, so a
   * missing field arrives here looking like a deliberate zero — and a price of
   * 0 is a claim, not a price (#1900 caught one on the storefront).
   */
  if (!Number.isFinite(next) || next <= 0) {
    return {
      ok: false,
      reason: "not_a_price",
      message:
        `unit_price must be a number greater than 0 — received ${JSON.stringify(
          input.unitPrice
        )}. A price of 0 is a claim, not a price.`,
    }
  }

  const previous =
    currentUnitPrice == null || !Number.isFinite(Number(currentUnitPrice))
      ? null
      : Number(currentUnitPrice)

  if (previous !== null && previous === next) {
    return {
      ok: false,
      reason: "unchanged",
      message: `This line is already priced at ${next}.`,
    }
  }

  return { ok: true, unit_price: next, previous }
}
