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
 * ## It now FAILS CLOSED — and here is the evidence that made that safe
 *
 * S15 shipped this guard refusing only a *proven* mismatch: where either side
 * was unresolvable it allowed the read and logged, because failing closed on
 * "cannot tell" is the #1397 outcome — the buyer page down for whole tenants,
 * a certain loss traded against a possible leak. That sizing came off a dev
 * database and was wrong: the counts were dominated by e2e detritus.
 *
 * Measured against **prod** on 2026-08-24 (`backfill-quote-tenancy`, dry run,
 * plus a key/store cross-check):
 *
 *   - **8 of 8** `partner_quote` rows carry a `store_id`. Nothing to backfill.
 *   - **0 of 13** stores lack `default_sales_channel_id`.
 *   - **14 of 14** publishable keys carry exactly one sales channel, and every
 *     one of those channels is some store's default — so every live caller
 *     resolves.
 *
 * So none of the three escape hatches has anything real behind it, and each is
 * now a refusal. Re-run that job before assuming this still holds: a new store
 * created without a default sales channel would lock its own buyers out, which
 * is why `check_quote_readiness` and the job both report the count.
 *
 * ## Why 404 and not 403
 *
 * The same reason an unknown token 404s: a prober must not learn that a token
 * is real by being told they are on the wrong shop. Every refusal below is the
 * same body a nonexistent token gets.
 */
export async function assertQuoteVisibleToCaller(
  req: any,
  quote: { id?: string; store_id?: string | null }
): Promise<void> {
  const logger: any = req.scope.resolve(ContainerRegistrationKeys.LOGGER)
  const quoteStoreId = quote?.store_id ?? null

  const refuse = (why: string): never => {
    // Logged as a refusal, not an error: the common cause is a link forwarded
    // to the wrong shop, not an attack. It still must not render.
    logger?.warn?.(`[quote] read REFUSED for ${quote?.id}: ${why}`)
    throw new MedusaError(MedusaError.Types.NOT_FOUND, "Quote not found")
  }

  if (!quoteStoreId) {
    // Pre-S15 rows had no store_id. Prod has none left; one appearing again
    // means a mint path is dropping the column, not that a buyer is stuck.
    refuse("the quote carries no store_id, so no storefront can own it")
  }

  const ctx = (req as any).publishable_key_context
  if (!ctx?.sales_channel_ids?.length) {
    // Core rejects a *missing* x-publishable-api-key with a 400 before the
    // route runs, so reaching here means the key exists and resolves to no
    // sales channel — the dangling key of #1397.
    refuse("the calling key resolves to no sales channel, so the store is unknown")
  }

  const store = await getStoreFromPublishableKey(ctx, req.scope)
  if (!store?.id) {
    refuse(
      `no store resolves from the calling key's sales channels ` +
        `(${ctx.sales_channel_ids.join(",")}) — the store is probably missing ` +
        `default_sales_channel_id`
    )
  }

  if (store.id !== quoteStoreId) {
    refuse(`it belongs to ${quoteStoreId}, requested through store ${store.id}`)
  }
}
