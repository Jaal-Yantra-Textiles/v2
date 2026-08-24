import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { deletePriceListsWorkflow } from "@medusajs/medusa/core-flows"

import { PARTNER_QUOTE_MODULE } from ".."

/**
 * Revoke one quote (#1389 S5, extracted for the partner surface in #1517).
 *
 * 🔴 Flipping `status` alone is NOT a revoke. The quote's prices live in a
 * real, active price list scoped to the buyer's customer group — if that list
 * survives, the buyer keeps the quoted prices in any cart they build, whatever
 * the quote row says. The link dies and the discount does not.
 *
 * So the price list is deleted FIRST and only then is the row marked. Doing it
 * in that order means a failure leaves a quote that still says "active"
 * alongside a list that is already gone — visibly inconsistent and safe. The
 * reverse order would leave a revoked-looking quote still quietly pricing
 * carts, which is the failure nobody would notice.
 *
 * ## Why this is a function and not two handlers
 *
 * The partner route (#1517) needs precisely the admin route's body, and the
 * admin route's body contains one defect worth never copying: it once
 * destructured the `updatePartnerQuotes` result and threw AFTER the price list
 * had been deleted and the status written, so every revoke on prod did its
 * whole job and answered 500 — inviting a retry of a destructive operation.
 * Two copies of that body is two places for it to come back. The ordering
 * above, the idempotent early return and the un-destructured update now exist
 * once, and both surfaces differ only in who is allowed to call them and what
 * the audit line says.
 *
 * Ownership is NOT checked here. The caller has already decided the actor may
 * touch this quote — the partner route by scoping its lookup to the partner in
 * the auth context, the admin route because an admin may touch any of them —
 * and a guard that runs after the row is in hand cannot re-derive who asked.
 */
export const revokeQuote = async (
  scope: any,
  quote: any,
  actor: { type: "partner" | "admin"; id?: string | null }
): Promise<{
  quote: any
  price_list_deleted: boolean
  already_revoked?: boolean
}> => {
  const service: any = scope.resolve(PARTNER_QUOTE_MODULE)
  const logger: any = scope.resolve(ContainerRegistrationKeys.LOGGER)

  if (quote.status === "revoked") {
    // Idempotent: re-revoking is a no-op, not an error. Anyone hitting the
    // button twice must not see a failure that suggests the first one did not
    // take.
    return { quote, price_list_deleted: false, already_revoked: true }
  }

  /**
   * #1440 moved this off `metadata` and onto a column. The metadata fallback
   * stays for rows minted before that migration ran — the backfill covers them,
   * but a revoke that silently skipped a live price list because a backfill was
   * missed is the exact failure this code exists to prevent.
   */
  const priceListId =
    (quote as any)?.price_list_id ?? (quote.metadata as any)?.price_list_id
  if (priceListId) {
    await deletePriceListsWorkflow(scope).run({ input: { ids: [priceListId] } })
    logger.info(`[quote] revoke ${quote.id} deleted price list ${priceListId}`)
  } else {
    // A quote with no recorded price list either never froze or was minted
    // before the id was stored. Say so rather than reporting a clean revoke.
    logger.warn(
      `[quote] revoke ${quote.id} had no price_list_id recorded — nothing to delete`
    )
  }

  /**
   * 🔴 NOT array-destructured. `updateX` returns whatever the inner service
   * returns: the `{ selector, data }` bulk form yields an ARRAY, the bare
   * entity form used here yields a SINGLE OBJECT. Destructuring it threw
   * `TypeError: (intermediate value) is not iterable` — and it threw *after*
   * the price list had been deleted and the status written.
   *
   * So every revoke on prod did its whole job and then answered 500. That is
   * the worst possible pairing for a destructive route: the caller sees a
   * failure and retries an operation that already ran. Found by revoking four
   * real quotes, not by reading the file — the `already_revoked` branch above
   * returns the row from `listPartnerQuotes` and so has always been fine,
   * which is exactly why a retry "worked" and hid the defect.
   */
  const updated = await service.updatePartnerQuotes({
    id: quote.id,
    status: "revoked",
  })

  const by = actor.type === "admin" ? "an admin" : "the partner"
  await service
    .recordEvent({
      quote_id: quote.id,
      type: "revoked",
      actor_type: actor.type,
      actor_id: actor.id ?? null,
      message: priceListId
        ? `Revoked by ${by}; the quoted price list was deleted.`
        : `Revoked by ${by}. No price list was recorded on the quote, so none was deleted.`,
      data: { price_list_id: priceListId ?? null },
    })
    .catch(() => {})

  return {
    quote: updated ?? { ...quote, status: "revoked" },
    price_list_deleted: !!priceListId,
  }
}
