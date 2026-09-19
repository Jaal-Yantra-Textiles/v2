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
  /**
   * Medusa sets this when a cart completes — but on this platform it is
   * almost never set: 2 of 48 carts locally, and the repo ships
   * `scripts/backfill-converted-cart-completed-at.ts` precisely because of
   * that gap. Kept as one signal, never as the only one. See `isConverted`.
   */
  completed_at?: string | Date | null
}

/**
 * 🔴 Has this design order become a real order?
 *
 * Asking `cart.completed_at` alone does NOT answer it. Measured on a local
 * database: **2 of 48 carts** carry `completed_at`, and `order_cart` holds
 * **1 row for 290 orders**. A guard keyed on either is a guard that does not
 * fire — a converted design order could be "repriced" through its cart, the
 * write would succeed, the toast would say so, and the buyer's ORDER would be
 * unchanged. A silent no-op reported as success.
 *
 * So the linked order is the authority, which is also exactly what the detail
 * page uses to decide it is past the cart stage. UI and API then agree about
 * what "converted" means rather than each deciding privately.
 *
 * ⚠️ That link is per DESIGN, not per cart, so a repeat customer's SECOND
 * design order for the same design reads as converted and is refused. That is
 * the safe direction: refusing costs an operator one order edit, while
 * allowing it writes a number nobody will ever read.
 */
export const isConverted = (input: {
  cart?: { completed_at?: string | Date | null } | null
  hasLinkedOrder?: boolean
}): boolean => Boolean(input.cart?.completed_at) || Boolean(input.hasLinkedOrder)

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
  /** Does an order already exist for this design? See `isConverted`. */
  hasLinkedOrder?: boolean
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
  if (isConverted({ cart, hasLinkedOrder: input.hasLinkedOrder })) {
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
  /** Does an order already exist for this design? See `isConverted`. */
  hasLinkedOrder?: boolean
}): RepriceDecision {
  const { cart, currentUnitPrice } = input

  if (!cart) {
    return { ok: false, reason: "no_cart", message: "This design order has no cart." }
  }
  if (isConverted({ cart, hasLinkedOrder: input.hasLinkedOrder })) {
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

export type CancelRefusal =
  | "no_cart"
  | "cart_completed"
  | "already_cancelled"
  | "no_reason"

export type CancelDecision =
  /**
   * `cancelled_reason` is the operator's words; the refusal branch's `reason`
   * is a machine code. Two different things, deliberately not sharing a name —
   * they did briefly, and a union whose discriminated branches disagree about
   * what one field MEANS is a trap for every reader after.
   */
  | { ok: true; cancelled_at: string; cancelled_reason: string }
  | { ok: false; reason: CancelRefusal; message: string }

/**
 * Retire a design order that should never be paid.
 *
 * ## Why cancel and not delete
 *
 * There was no way to do either: `/admin/designs/orders/:lineItemId` is GET
 * only, so a design order created with the wrong currency, the wrong buyer or
 * the wrong designs could only be ABANDONED — left in the list forever, looking
 * exactly like one a customer simply has not paid yet. The founder's instinct
 * was "delete it and make a new one"; the record is the reason not to.
 *
 * A design order that was sent to somebody is a thing that happened. The
 * checkout link must stop working, but the row, its price and its links are the
 * evidence of what was offered and for how much. So this is SOFT: a stamp on
 * the cart, not a removal.
 *
 * ## The reason is required
 *
 * 🔴 Not politeness. A cancelled design order and a stale one look identical a
 * month later, and "why is this cancelled" is the question the next person
 * asks. An optional field here would be empty on every row that mattered. The
 * platform already refuses to invent a human's reason on their behalf for
 * destructive maintenance jobs; this is the same rule.
 *
 * ## What it refuses
 *
 * A CONVERTED design order, because cancelling its cart would change nothing a
 * buyer sees — the order is the live object and has its own cancel. Silently
 * stamping the cart would leave the admin screen saying "cancelled" over an
 * order still being fulfilled, which is worse than refusing.
 */
export function decideCancel(input: {
  cart: (DesignOrderCart & { metadata?: Record<string, unknown> | null }) | null | undefined
  reason: unknown
  /** Does an order already exist for this design? See `isConverted`. */
  hasLinkedOrder?: boolean
  now?: Date
}): CancelDecision {
  const { cart } = input

  if (!cart) {
    return { ok: false, reason: "no_cart", message: "This design order has no cart." }
  }

  if (isConverted({ cart, hasLinkedOrder: input.hasLinkedOrder })) {
    return {
      ok: false,
      reason: "cart_completed",
      message:
        "This design order has already been converted to an order. Cancel the " +
        "order itself — cancelling the cart now would change nothing the buyer sees.",
    }
  }

  /**
   * Idempotent, and says so rather than stamping a second time. Re-cancelling
   * would overwrite the ORIGINAL reason and date with today's, quietly losing
   * the only record of why this was retired.
   */
  const existing = cart.metadata?.cancelled_at
  if (typeof existing === "string" && existing.trim()) {
    return {
      ok: false,
      reason: "already_cancelled",
      message: `This design order was already cancelled on ${existing}.`,
    }
  }

  const text = typeof input.reason === "string" ? input.reason.trim() : ""
  if (!text) {
    return {
      ok: false,
      reason: "no_reason",
      message:
        "A cancellation reason is required — a cancelled design order and a " +
        "stale one look identical later, and the reason is the difference.",
    }
  }

  return {
    ok: true,
    cancelled_at: (input.now ?? new Date()).toISOString(),
    cancelled_reason: text,
  }
}

/**
 * PURE: is this design order cancelled?
 *
 * One reader, so a surface cannot decide privately. Used by the detail route to
 * withhold the checkout link — a cancelled order whose link still works is the
 * cancel not having happened.
 */
export const isCancelled = (
  cart: { metadata?: Record<string, unknown> | null } | null | undefined
): boolean => {
  const v = cart?.metadata?.cancelled_at
  return typeof v === "string" && v.trim().length > 0
}
