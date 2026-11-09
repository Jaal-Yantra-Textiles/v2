import {
  planPartnerDeletion,
  type PartnerDeletionPlan,
} from "./partner-deletion-plan"

/**
 * Delete a partner's STOREFRONT and keep the partner (#2527).
 *
 * The partner-delete cascade (`partner-deletion-plan.ts`) already decides how a
 * store comes down: key links first, then the channel, then the store, all soft
 * and all restorable. This reuses that policy for the narrower case — the
 * partner stays (its payouts, people, runs and payment methods are history),
 * only the shop goes. Zovvy (2026-11-08) is the case: a third-party app copied
 * ~2,500 products into the store, and tearing it down took raw API calls.
 *
 * Products are NOT in scope: a partner's products may be listed on other
 * channels too. Delete them separately if they should go.
 */
export type StorefrontDeletionFacts = {
  partner_id: string
  partner_name?: string | null
  partner_status?: string | null
  /** Stores linked to the partner. */
  stores: Array<{ id: string; default_sales_channel_id: string | null }>
  publishable_keys: Array<{ id: string; sales_channel_ids: string[] }>
  live_order_ids: string[]
  /** Stock locations on the store's channel — reported, never deleted here. */
  stock_location_ids: string[]
}

export type StorefrontDeletionPlan = PartnerDeletionPlan & {
  store_id: string | null
  /** Partner↔store link to dismiss once the store is soft-deleted. */
  dismiss_partner_store: { partner_id: string; store_id: string } | null
}

export function planStorefrontDeletion(
  facts: StorefrontDeletionFacts
): StorefrontDeletionPlan {
  const name = facts.partner_name ?? facts.partner_id
  const blockers: string[] = []

  // Switching a live partner's shop off is `disable_store`. Deleting it is for
  // a partner we have stopped working with.
  if (facts.partner_status === "active") {
    blockers.push(
      `Partner ${name} is still active. Set the partner inactive first, or use disable_store to switch the storefront off without deleting it.`
    )
  }
  if (facts.stores.length === 0) {
    blockers.push(`Partner ${name} has no store.`)
  }
  if (facts.stores.length > 1) {
    blockers.push(
      `Partner ${name} has ${facts.stores.length} stores (${facts.stores
        .map((s) => s.id)
        .join(", ")}). This route deletes a partner's only store; it will not guess which one.`
    )
  }

  const store = facts.stores.length === 1 ? facts.stores[0] : null
  const channelIds = store?.default_sales_channel_id
    ? [store.default_sales_channel_id]
    : []

  const base = planPartnerDeletion({
    partner_id: facts.partner_id,
    partner_name: facts.partner_name,
    store_ids: store ? [store.id] : [],
    sales_channel_ids: channelIds,
    publishable_keys: facts.publishable_keys,
    product_ids: [],
    live_order_ids: facts.live_order_ids,
    force: false,
  })

  const allBlockers = [...blockers, ...base.blockers]
  if (allBlockers.length || !store) {
    return {
      deletable: false,
      blockers: allBlockers,
      unlink_keys: [],
      soft_delete_sales_channel_ids: [],
      soft_delete_store_ids: [],
      soft_delete_product_ids: [],
      preserved: [],
      store_id: null,
      dismiss_partner_store: null,
    }
  }

  return {
    ...base,
    store_id: store.id,
    dismiss_partner_store: { partner_id: facts.partner_id, store_id: store.id },
    preserved: [
      "The partner itself, its admins, payouts, people and production runs.",
      "Products — they may sell on other channels. Delete them separately.",
      ...(facts.stock_location_ids.length
        ? [
            `Stock location(s) ${facts.stock_location_ids.join(", ")} — real stock. Delete with DELETE /admin/stock-locations/:id once empty.`,
          ]
        : []),
      "Orders on the channel — history, never deleted.",
      "Default region — shared with other stores.",
      "Publishable key rows — unlinked and inert, kept so a restore returns the SAME token.",
    ],
  }
}
