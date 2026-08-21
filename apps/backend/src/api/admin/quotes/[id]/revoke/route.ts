import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { deletePriceListsWorkflow } from "@medusajs/medusa/core-flows"

import { PARTNER_QUOTE_MODULE } from "../../../../../modules/partner-quote"

/**
 * Revoke a quote (#1389 S5).
 *
 * 🔴 Flipping `status` alone is NOT a revoke. The quote's prices live in a real,
 * active price list scoped to the buyer's customer group — if that list survives,
 * the buyer keeps the quoted prices in any cart they build, whatever the quote
 * row says. The link dies and the discount does not.
 *
 * So this deletes the price list FIRST and only then marks the row. Doing it in
 * that order means a failure leaves a quote that still says "active" alongside a
 * list that is already gone — visibly inconsistent and safe. The reverse order
 * would leave a revoked-looking quote still quietly pricing carts, which is the
 * failure nobody would notice.
 *
 * The buyer's page 404s either way: an unknown token and a revoked one are
 * deliberately indistinguishable to a prober.
 */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const service: any = req.scope.resolve(PARTNER_QUOTE_MODULE)
  const logger: any = req.scope.resolve(ContainerRegistrationKeys.LOGGER)

  const quotes = await service.listPartnerQuotes({ id: req.params.id })
  const quote = quotes?.[0]
  if (!quote) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, "Quote not found")
  }

  if (quote.status === "revoked") {
    // Idempotent: re-revoking is a no-op, not an error. An operator hitting the
    // button twice must not see a failure that suggests the first one did not
    // take.
    return res.json({ quote, already_revoked: true })
  }

  /**
   * #1440 moved this off `metadata` and onto a column. The metadata fallback
   * stays for rows minted before that migration ran — the backfill covers them,
   * but a revoke that silently skipped a live price list because a backfill was
   * missed is the exact failure this route exists to prevent.
   */
  const priceListId =
    (quote as any)?.price_list_id ?? (quote.metadata as any)?.price_list_id
  if (priceListId) {
    await deletePriceListsWorkflow(req.scope).run({
      input: { ids: [priceListId] },
    })
    logger.info(`[quote] revoke ${quote.id} deleted price list ${priceListId}`)
  } else {
    // A quote with no recorded price list either never froze or was minted
    // before the id was stored. Say so rather than reporting a clean revoke.
    logger.warn(
      `[quote] revoke ${quote.id} had no price_list_id recorded — nothing to delete`
    )
  }

  const [updated] = await service.updatePartnerQuotes({
    id: quote.id,
    status: "revoked",
  })

  await service
    .recordEvent({
      quote_id: quote.id,
      type: "revoked",
      actor_type: "admin",
      actor_id: (req as any).auth_context?.actor_id ?? null,
      message: priceListId
        ? "Revoked by an admin; the quoted price list was deleted."
        : "Revoked by an admin. No price list was recorded on the quote, so none was deleted.",
      data: { price_list_id: priceListId ?? null },
    })
    .catch(() => {})

  res.json({
    quote: updated ?? { ...quote, status: "revoked" },
    price_list_deleted: !!priceListId,
  })
}
