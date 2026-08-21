/**
 * What travels with a partner when it is deleted — decided as policy, not
 * inferred at each call site.
 *
 * ## Why this exists
 *
 * `deletePartnerWorkflow` used to soft-delete the partner and its admins and
 * nothing else. The store, its sales channel, its publishable key, its products
 * and the partner↔store link all survived, with no guard even on live orders.
 *
 * That partialness is not academic: it is exactly how the orphan "Sharhlo
 * Store" came to exist, and removing that orphan is what took every partner
 * storefront down on 2026-08-21. A deletion that leaves half a tenant standing
 * manufactures the strays that a later cleanup has to guess about.
 *
 * ## The three tiers
 *
 * 🔑 **Nothing here is ever hard-deleted.** #1306 third-party MCP clients hold
 * references, and the standing rule is forward, never delete. Every action in
 * the plan is reversible by the workflow's own compensation.
 *
 * 1. **Travels with the partner** — meaningless without it: the store, its
 *    sales channel, its products. All soft-deleted, all restorable.
 * 2. **Never touched** — commercial history: orders, fulfilments, payouts,
 *    production runs, inventory levels and the stock location holding them.
 *    Deleting those corrupts accounting. The default region is shared across
 *    ~10 stores on prod and is never in scope.
 * 3. **Disabled, not deleted** — the publishable key. See below.
 *
 * ## Why the key is UNLINKED rather than revoked or deleted
 *
 * Revoking is the obvious "disable", and it is a ONE-WAY DOOR: core's
 * `UpdateApiKeyDTO` carries `title` and nothing else, and there is no
 * un-revoke. A reversible deletion cannot contain an irreversible step.
 * Deleting the key outright is worse — the storefront's configured token would
 * never come back.
 *
 * So the plan dismisses the key↔sales-channel LINK and leaves the key row
 * intact. The storefront stops resolving (no key matches the channel), the
 * token survives for a restore, and — the part that matters — the key is never
 * left pointing at a soft-deleted channel. That dangling state is precisely
 * what expanded to `sales_channels: [null]` and 500'd a cross-tenant query on
 * 2026-08-21. Unlinking first means it never exists, not even between two
 * awaits, and not at all if the channel soft-delete subsequently fails.
 */

export type PartnerDeletionFacts = {
  partner_id: string
  partner_name?: string | null
  /** Stores linked to this partner (usually one). */
  store_ids: string[]
  /** Those stores' default sales channels. */
  sales_channel_ids: string[]
  /** Publishable keys linked to any of those channels, with their links. */
  publishable_keys: Array<{ id: string; sales_channel_ids: string[] }>
  /** Products this partner owns, via the partner↔product ownership link. */
  product_ids: string[]
  /**
   * Orders that are still in flight — retail (on the partner's channel) and
   * work-orders (on the partner↔order link). Terminal orders are history and
   * never block.
   */
  live_order_ids: string[]
  /** Operator override: delete anyway, live orders and all. */
  force: boolean
}

export type PartnerDeletionPlan = {
  deletable: boolean
  blockers: string[]
  /** Key↔channel links to dismiss, BEFORE any channel is soft-deleted. */
  unlink_keys: Array<{ key_id: string; sales_channel_ids: string[] }>
  soft_delete_sales_channel_ids: string[]
  soft_delete_store_ids: string[]
  soft_delete_product_ids: string[]
  /** Human-readable, for the route response and the audit trail. */
  preserved: string[]
}

/**
 * PURE: given the facts, what should travel with this partner and what — if
 * anything — should stop the deletion.
 *
 * Every blocker is returned, not just the first: an operator who clears one
 * reason and retries should not discover a second on the next pass.
 */
export function planPartnerDeletion(
  facts: PartnerDeletionFacts
): PartnerDeletionPlan {
  const blockers: string[] = []

  if (facts.live_order_ids.length && !facts.force) {
    const shown = facts.live_order_ids.slice(0, 5).join(", ")
    const more = facts.live_order_ids.length > 5 ? ", …" : ""
    blockers.push(
      `Partner ${facts.partner_name ?? facts.partner_id} has ${facts.live_order_ids.length} order(s) still in flight (${shown}${more}). Deleting it would take their storefront and products out from under orders someone is waiting on. Complete or cancel them, or pass force: true.`
    )
  }

  const deletable = blockers.length === 0

  // A blocked plan carries no actions: nothing should read `soft_delete_*` off
  // a refusal and act on it anyway.
  if (!deletable) {
    return {
      deletable,
      blockers,
      unlink_keys: [],
      soft_delete_sales_channel_ids: [],
      soft_delete_store_ids: [],
      soft_delete_product_ids: [],
      preserved: [],
    }
  }

  // Only links that actually point at THIS partner's channels are dismissed. A
  // key shared with another tenant's channel keeps that link.
  const channelIds = new Set(facts.sales_channel_ids)
  const unlink_keys = facts.publishable_keys
    .map((k) => ({
      key_id: k.id,
      sales_channel_ids: k.sales_channel_ids.filter((id) => channelIds.has(id)),
    }))
    .filter((k) => k.sales_channel_ids.length > 0)

  return {
    deletable,
    blockers,
    unlink_keys,
    soft_delete_sales_channel_ids: [...facts.sales_channel_ids],
    soft_delete_store_ids: [...facts.store_ids],
    soft_delete_product_ids: [...facts.product_ids],
    preserved: [
      "Orders, fulfilments, payouts and production runs — commercial history, never deleted.",
      "Stock location and its inventory levels — real stock, not a tenant artefact.",
      "Default region — shared with other stores.",
      "Publishable key rows — unlinked and inert, kept so a restore returns the SAME token.",
      ...(facts.force && facts.live_order_ids.length
        ? [
            `FORCED past ${facts.live_order_ids.length} live order(s) — they are untouched, but their storefront is now dark.`,
          ]
        : []),
    ],
  }
}
