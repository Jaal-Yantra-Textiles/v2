import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { updatePriceListsWorkflow } from "@medusajs/medusa/core-flows"

import { PARTNER_QUOTE_MODULE } from ".."
import { effectiveQuoteStatus } from "./token"

/**
 * Correct a quote in place, before the buyer accepts it.
 *
 * ## Why this exists
 *
 * A minted quote had exactly two futures: accepted, or revoked. So a partner
 * who quoted the wrong freight — the common case, because a lane no carrier
 * would rate falls through to a flat tier nobody chose — could only revoke and
 * re-mint. That emails the buyer a NEW quote number for what is, to them, a
 * correction to the document they are already reading. It also mints a fresh
 * price list and supersedes the old one, which is a lot of machinery to move a
 * shipping figure.
 *
 * An adjustment keeps the SAME link, the same quote number and the same frozen
 * prices, and changes only the things that are columns on the row.
 *
 * ## 🔴 What it deliberately cannot change
 *
 * Line prices, quantities and variants. Those do not live on this row — they
 * live in a real, active price list scoped to the buyer's customer group, and
 * the mint guards writing it with a re-read assertion that `mint-quote`'s own
 * docblock calls "the only thing standing between a quote and a platform-wide
 * price cut". Re-implementing that assertion here, in a second place, to save a
 * re-mint would be trading a small convenience for the largest blast radius in
 * this module. Change the basket by re-minting; that path already supersedes
 * the old quote correctly (#1435).
 *
 * ## 🔴 Expiry moves the price list too
 *
 * `expires_at` on this row is NOT where expiry is enforced — the minted price
 * list carries a native `ends_at`, set from the same date at mint, and THAT is
 * what stops the buyer's prices applying. Extending one without the other
 * produces a page that says the quote is live above prices that have already
 * stopped working. So both move, price list first: if that write fails the
 * quote still shows the old, shorter date, which is the safe direction to be
 * wrong in.
 */

export type QuoteAdjustment = {
  /** In the QUOTE's currency. Stored with `source: "manual"` — see below. */
  freight_amount?: number | null
  /** Why that number. Evidence, exactly like `duty_basis`. */
  freight_basis?: string | null
  partner_note?: string | null
  /** Absolute, not a delta. */
  expires_at?: Date | string | null
}

export type AdjustmentDiff = {
  field: string
  from: unknown
  to: unknown
}

/**
 * PURE: what actually changed, ignoring keys the caller did not send and values
 * that are already what they would be set to.
 *
 * 🔑 A no-op adjustment must be visible as a no-op. Without this, saving a form
 * nobody edited would stamp `adjusted_at`, write a timeline event and — worse —
 * potentially email the buyer about a change that did not happen.
 */
export function diffAdjustment(
  quote: any,
  adjustment: QuoteAdjustment
): AdjustmentDiff[] {
  const diffs: AdjustmentDiff[] = []

  if (adjustment.freight_amount !== undefined) {
    const to = adjustment.freight_amount
    const from = quote?.quoted_freight
    if (Number(from ?? NaN) !== Number(to ?? NaN)) {
      diffs.push({ field: "quoted_freight", from: from ?? null, to: to ?? null })
    }
  }

  if (adjustment.partner_note !== undefined) {
    const to = adjustment.partner_note ?? null
    const from = quote?.partner_note ?? null
    if (String(from ?? "") !== String(to ?? "")) {
      diffs.push({ field: "partner_note", from, to })
    }
  }

  if (adjustment.expires_at !== undefined) {
    const toMs = adjustment.expires_at
      ? new Date(adjustment.expires_at as any).getTime()
      : null
    const fromMs = quote?.expires_at
      ? new Date(quote.expires_at).getTime()
      : null
    if (toMs !== fromMs) {
      diffs.push({
        field: "expires_at",
        from: fromMs ? new Date(fromMs).toISOString() : null,
        to: toMs ? new Date(toMs).toISOString() : null,
      })
    }
  }

  return diffs
}

/**
 * PURE: does the buyer need to be told?
 *
 * 🔑 Only when the number they owe goes UP. A reduction in the buyer's favour
 * needs no interruption — they see it the next time they open the link, which
 * is always live. A rise is different: they may have already done their margin
 * arithmetic on the old figure, and letting them discover it silently is how a
 * correction reads as a bait-and-switch.
 *
 * A note or expiry change alone never emails. Re-sending a quote because
 * somebody fixed a typo trains a buyer to ignore the mails that matter.
 */
export function adjustmentNeedsNotice(diffs: AdjustmentDiff[]): boolean {
  const freight = diffs.find((d) => d.field === "quoted_freight")
  if (!freight) return false
  return Number(freight.to ?? 0) > Number(freight.from ?? 0)
}

/**
 * Apply an adjustment. Returns the updated row and what moved.
 *
 * Ownership is NOT checked here — the caller has already decided the actor may
 * touch this quote, exactly as `revokeQuote` documents.
 */
export const adjustQuote = async (
  scope: any,
  quote: any,
  adjustment: QuoteAdjustment,
  actor: { type: "partner" | "admin"; id?: string | null },
  now: Date = new Date()
): Promise<{ quote: any; changes: AdjustmentDiff[]; notify: boolean }> => {
  const service: any = scope.resolve(PARTNER_QUOTE_MODULE)
  const logger: any = scope.resolve(ContainerRegistrationKeys.LOGGER)

  /**
   * 🔴 An accepted quote is not adjustable by anyone.
   *
   * Acceptance means a real cart exists at these figures, possibly with a
   * deposit paid against it. Moving the freight afterwards changes what the
   * buyer owes on an agreement they have already made, and nothing would tell
   * them. This is the same refusal the partner revoke route makes, for the same
   * reason — and unlike revoke, an admin gets no override here, because there
   * is no version of "silently re-price a deal the buyer committed to" that is
   * an operator's call to make.
   *
   * NOT_ALLOWED rather than CONFLICT: the framework's handler REPLACES a
   * CONFLICT message with a generic "retry with an Idempotency-Key" line, so
   * the caller would be told to retry the one thing that cannot work.
   */
  if (quote.accepted_at) {
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      "This quote has already been accepted by the buyer, so it can no longer be adjusted — the accepted cart is priced from it. Re-quote instead."
    )
  }

  /**
   * 🔴 Only a LIVE quote can be corrected, and `status` alone does not say that
   * (#1510): the column has no `expired` value, so a quote whose date passed
   * still reads `active`. Adjusting a dead quote would produce a corrected
   * document at a link that refuses to price anything.
   */
  const effective = effectiveQuoteStatus(quote, now)
  if (effective !== "active") {
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      `This quote is ${effective}, so it cannot be adjusted. Mint a new quote for this buyer instead.`
    )
  }

  const changes = diffAdjustment(quote, adjustment)
  if (!changes.length) {
    // Idempotent, and honest: saving a form nobody edited must not stamp an
    // adjustment, write a timeline entry, or mail the buyer.
    return { quote, changes: [], notify: false }
  }

  const movedExpiry = changes.find((c) => c.field === "expires_at")

  /**
   * The price list FIRST — see the header. Its `ends_at` is where expiry is
   * actually enforced; this row's `expires_at` is the copy people read.
   */
  if (movedExpiry && quote.price_list_id) {
    try {
      // `price_lists_data`, not `{selector, update}` — the same shape the
      // supersede step in `mint-quote` uses. Caught by `check:prod-build`.
      await updatePriceListsWorkflow(scope).run({
        input: {
          price_lists_data: [
            { id: quote.price_list_id, ends_at: movedExpiry.to } as any,
          ],
        },
      })
    } catch (e: any) {
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        `The quote's price list could not be re-dated (${e?.message ?? e}), so the expiry was not changed. Nothing else was written.`
      )
    }
  }

  const update: Record<string, any> = { id: quote.id, adjusted_at: now }

  const freightChange = changes.find((c) => c.field === "quoted_freight")
  if (freightChange) {
    update.quoted_freight = freightChange.to
    /**
     * 🔴 `source` must travel with the amount.
     *
     * The buyer page only re-supplies a hand-named freight on re-read when the
     * row says the freight was manual (#1439 S12). Writing the amount alone
     * would leave the LIVE half re-running the estimate — so the page would
     * render the corrected figure beside the old estimated one and visibly
     * disagree with itself.
     */
    update.quoted_freight_source = "manual"
    if (adjustment.freight_basis !== undefined) {
      update.quoted_freight_basis = adjustment.freight_basis ?? null
    }
    // The landed total is the number the buyer reads; it must move with its
    // parts rather than being recomputed by whoever renders next.
    const subtotal = Number(quote.quoted_subtotal ?? 0)
    const tax = Number(quote.quoted_tax_total ?? 0)
    update.quoted_landed_total =
      subtotal + Number(freightChange.to ?? 0) + tax
  }

  if (changes.some((c) => c.field === "partner_note")) {
    update.partner_note = adjustment.partner_note ?? null
  }
  if (movedExpiry) {
    update.expires_at = movedExpiry.to
  }

  // 🔑 NOT destructured. `updateX` returns an OBJECT for the entity form, and
  // `const [x] = await ...` throws AFTER the write — the exact defect that made
  // every revoke on prod answer 500 having already done its whole job.
  const updated = await service.updatePartnerQuotes(update)

  await service
    .recordEvent({
      quote_id: quote.id,
      type: "adjusted",
      actor_type: actor.type,
      actor_id: actor.id ?? null,
      message: changes
        .map((c) => `${c.field}: ${String(c.from)} → ${String(c.to)}`)
        .join("; "),
      data: { changes },
    })
    .catch(() => {})

  logger?.info?.(
    `[quote] ${actor.type}=${actor.id ?? "?"} adjusted quote=${quote.id}: ${changes
      .map((c) => c.field)
      .join(",")}`
  )

  return { quote: updated, changes, notify: adjustmentNeedsNotice(changes) }
}
