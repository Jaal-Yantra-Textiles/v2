// #859 S2 (#861) — pure decision for the artisan cross-list subscriber.
//
// Kept free of container/query so it's unit-testable in isolation; the
// subscriber gathers the facts (owner link, product status, core channel,
// current channels) and delegates the verdict here.

export type CrossListFacts = {
  /** True when a partner-product link exists (product is artisan-owned). */
  hasOwnerLink: boolean
  /** Native ProductStatus of the product. */
  status?: string | null
  /** Core (platform) store's sales channel id, or null if unresolved. */
  coreChannelId?: string | null
  /** Sales channel ids the product is already on. */
  currentChannelIds: string[]
}

export type CrossListDecision =
  | { action: "skip"; reason: string }
  | { action: "cross_list"; channelId: string }

/**
 * Decide whether a just-updated product should be cross-listed to the core
 * channel. Only an artisan-owned, published product not already on the core
 * channel gets listed; everything else is skipped with a reason.
 */
export function decideCrossList(facts: CrossListFacts): CrossListDecision {
  if (!facts.hasOwnerLink) return { action: "skip", reason: "not_artisan_owned" }
  if (facts.status !== "published") return { action: "skip", reason: "not_published" }
  if (!facts.coreChannelId) return { action: "skip", reason: "no_core_channel" }
  if (facts.currentChannelIds.includes(facts.coreChannelId)) {
    return { action: "skip", reason: "already_listed" }
  }
  return { action: "cross_list", channelId: facts.coreChannelId }
}
