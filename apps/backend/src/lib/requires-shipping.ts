/**
 * #1195 — `requires_shipping` repair helpers.
 *
 * Medusa DERIVES a line item's `requires_shipping` from
 * `hasShippingProfile || someInventoryRequiresShipping`
 * (core-flows `prepare-line-item-data.js`), and `create-fulfillment` copies the
 * item flag onto the fulfillment. Most of our catalogue has no shipping profile
 * and sells `manage_inventory: false` variants, so both operands are false and
 * the dashboard then hides "Mark as shipped" on that flag alone.
 *
 * TWO INTERLOCKS make `requires_shipping: true` load-bearing rather than
 * cosmetic — both of them throw, and both were found the hard way:
 *
 *  1. CART. `completeCartWorkflow` runs `validateShippingStep`: an item that
 *     requires shipping needs a selected shipping method whose profile matches
 *     `item.variant.product.shipping_profile.id`. Our design line items are
 *     custom-priced with NO variant, so a `true` on the cart makes checkout
 *     unsatisfiable. This is why the two `requires_shipping: false` lines in
 *     `create-draft-order-from-designs.ts` and the design checkout route MUST
 *     stay false — repair happens at the order boundary instead.
 *
 *  2. FULFILLMENT. `create-fulfillment.js:78-83` throws
 *     "Shipping profile X does not match the shipping profile of the order
 *     item Y" when a requires-shipping item's product profile differs from the
 *     chosen option's. For a product with NO profile that comparison is
 *     `undefined !== sp_...` — always true — so flipping the flag on a
 *     profile-less product does not reveal the shipment action, it makes the
 *     order UNFULFILLABLE.
 *
 * Hence the rule below: only ever flip a line item whose product actually
 * carries a shipping profile. That is exactly the draft-order defect (profile
 * present, derivation still says false). Profile-less products are fixed by
 * giving them a profile — see the `backfill-product-shipping-profiles` DP job
 * — not by flipping the flag.
 *
 * Repairing a FULFILLMENT's own flag is unconditional and safe: nothing
 * re-validates it after creation, and it is the value the dashboard gates on.
 */

/**
 * PURE: the ids of order line items whose `requires_shipping` can safely be
 * repaired to `true`. Requires BOTH an explicit `false` (an absent flag is left
 * alone rather than guessed at) AND a product shipping profile, without which
 * the flag would make the item unfulfillable. Exported for unit testing.
 */
export function lineItemIdsNeedingShippingFlag(items: any[] | undefined): string[] {
  return (items ?? [])
    .filter(
      (item: any) =>
        item?.id &&
        item?.requires_shipping === false &&
        !!resolveItemShippingProfileId(item)
    )
    .map((item: any) => item.id as string)
}

/**
 * PURE: the shipping profile id behind a line item, whichever shape the caller
 * queried it in (`product.shipping_profile.id` from query.graph on the order,
 * or `variant.product.shipping_profile.id` from a module retrieve).
 * Exported for unit testing.
 */
export function resolveItemShippingProfileId(item: any): string | undefined {
  return (
    item?.product?.shipping_profile?.id ??
    item?.variant?.product?.shipping_profile?.id ??
    undefined
  )
}
