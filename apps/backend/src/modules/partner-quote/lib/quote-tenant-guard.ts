import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"

import { getStoreFromPublishableKey } from "../../../api/store/helpers"

/**
 * Keep one partner's quote off another partner's storefront (#1439 S15).
 *
 * ## The hole
 *
 * `/store/b2b/quotes/:token` looked the quote up by token hash and rendered it,
 * full stop. It never asked whether the storefront doing the asking was the one
 * the quote was minted for. Reproduced locally against three DIFFERENT stores:
 * all three publishable keys returned 200 for the same token, so a competitor's
 * shop would happily render the buyer's name, their company, both parties' tax
 * registrations and the negotiated prices — the whole commercial document.
 *
 * The accept route beside it was worse: it builds a real cart bound to the
 * quote's own customer and price list, so the wrong storefront could start an
 * order against another partner's frozen prices.
 *
 * This is the #1397 family — a cross-tenant read on a public route — and the
 * token being high-entropy is a reason it is unlikely to be *found*, never a
 * reason it is safe once forwarded, logged, or pasted into a support thread.
 *
 * ## Why it refuses only a PROVEN mismatch
 *
 * 🔴 Failing closed on "cannot tell" would take the feature down for most
 * tenants, which is the actual #1397 outcome and worse than the leak. The data
 * says so plainly: **24 of 28 stores carry no `default_sales_channel_id`**, and
 * that column is the only path from a publishable key back to a store — so the
 * caller is unresolvable most of the time. **12 of 16 existing quotes have a
 * null `store_id`**, because the column postdates them.
 *
 * So the rule is: refuse when both sides resolve AND disagree. Otherwise allow
 * and log, because a buyer who cannot open the quote they were sent is a
 * certain loss while this leak is a possible one.
 *
 * That is a deliberate half-measure and it should not stay one. It becomes a
 * real boundary once both backfills are done:
 *   1. `store_id` on every `partner_quote` row, and
 *   2. `default_sales_channel_id` on every `store`.
 * Then flip the two `return`s below to throws. The warnings exist to tell you
 * when that is safe — a clean log means nothing is relying on the gap.
 *
 * ## Why 404 and not 403
 *
 * The same reason an unknown token 404s: a prober must not learn that a token
 * is real by being told they are on the wrong shop.
 */
export async function assertQuoteVisibleToCaller(
  req: any,
  quote: { id?: string; store_id?: string | null }
): Promise<void> {
  const logger: any = req.scope.resolve(ContainerRegistrationKeys.LOGGER)
  const quoteStoreId = quote?.store_id ?? null

  if (!quoteStoreId) {
    logger?.warn?.(
      `[quote] tenant check SKIPPED for ${quote?.id}: the quote has no store_id ` +
        `(minted before the column). It will render on any storefront.`
    )
    return
  }

  const ctx = (req as any).publishable_key_context
  if (!ctx?.sales_channel_ids?.length) {
    logger?.warn?.(
      `[quote] tenant check SKIPPED for ${quote?.id}: the request carries no ` +
        `publishable-key sales channels, so the calling store is unknown.`
    )
    return
  }

  const store = await getStoreFromPublishableKey(ctx, req.scope)
  if (!store?.id) {
    logger?.warn?.(
      `[quote] tenant check SKIPPED for ${quote?.id}: no store resolves from the ` +
        `calling key's sales channels (${ctx.sales_channel_ids.join(",")}) — ` +
        `the store is probably missing default_sales_channel_id.`
    )
    return
  }

  if (store.id !== quoteStoreId) {
    // Logged as a refusal, not an error: the common cause is a link forwarded
    // to the wrong shop, not an attack. It still must not render.
    logger?.warn?.(
      `[quote] cross-tenant read REFUSED: quote ${quote?.id} belongs to ` +
        `${quoteStoreId}, requested through store ${store.id}.`
    )
    throw new MedusaError(MedusaError.Types.NOT_FOUND, "Quote not found")
  }
}
