import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import { PARTNER_QUOTE_MODULE } from "../../../modules/partner-quote"
import { buildQuoteListQuery } from "../../../modules/partner-quote/lib/list-query"
import { mintQuoteWorkflow } from "../../../workflows/partner-quote/mint-quote"
import { getPartnerStore, tryGetPartnerStore } from "../helpers"

/**
 * The partner's own quotes. Scoped by `partner_id`, never listed globally.
 *
 * 🔑 `partner_id` is passed as a PINNED filter, which `buildQuoteListQuery`
 * refuses to let a query string override. The list previously ignored
 * `limit`/`offset` entirely while `usePartnerQuotes` sent them, so the table's
 * pager moved a window over a set that was never windowed and `count` was the
 * length of everything.
 */
export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const { partner, store } = await tryGetPartnerStore(req.auth_context, req.scope)
  if (!store) {
    return res.json({ quotes: [], count: 0 })
  }

  const service: any = req.scope.resolve(PARTNER_QUOTE_MODULE)
  const { filters, config } = buildQuoteListQuery(req.query as any, {
    partner_id: partner.id,
  })

  const [quotes, count] = await service.listAndCountPartnerQuotes(
    filters,
    config
  )

  res.json({ quotes, count, limit: config.take, offset: config.skip })
}

/**
 * Mint a quote (#1389 S3).
 *
 * 🔑 The raw token is returned HERE and nowhere else — only its sha256 is
 * persisted, so a database read cannot reconstruct a working link. If the
 * caller loses this response, the quote must be re-minted.
 */
export const POST = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const { partner, store } = await getPartnerStore(req.auth_context, req.scope)
  const body = req.validatedBody as any

  const { result } = await mintQuoteWorkflow(req.scope).run({
    input: {
      partner_id: partner.id,
      store: { id: store.id, default_location_id: store.default_location_id },
      buyer_email: body.buyer_email,
      recipient_name: body.recipient_name ?? null,
      recipient_company: body.recipient_company ?? null,
      partner_note: body.partner_note ?? null,
      lines: body.lines,
      destination_country_code: body.destination_country_code,
      destination_postal_code: body.destination_postal_code ?? null,
      destination_city: body.destination_city ?? null,
      currency_code: body.currency_code,
      region_id: body.region_id ?? null,
      carrier: body.carrier,
      duties_prepaid: body.duties_prepaid ?? false,
      ttl_days: body.ttl_days,
      created_by: req.auth_context?.actor_id ?? null,
    },
  })

  // Best-effort: activity logging must never turn a successful mint into a 500.
  // A lost log line is recoverable; a failed mint that already created a live
  // price list is not.
  const quoteService: any = req.scope.resolve(PARTNER_QUOTE_MODULE)
  await quoteService
    .recordEvent({
      quote_id: (result as any)?.quote?.id,
      type: "minted",
      actor_type: "partner",
      actor_id: partner.id,
      message: `Quote minted with ${body.lines.length} line(s).`,
      data: { line_count: body.lines.length, ttl_days: body.ttl_days ?? null },
    })
    .catch(() => {})

  const logger: any = req.scope.resolve(ContainerRegistrationKeys.LOGGER)
  logger.info(
    `[quote] partner=${partner.id} minted quote=${(result as any)?.quote?.id} lines=${body.lines.length}`
  )

  res.status(201).json({
    quote: (result as any)?.quote,
    /** Once. Never retrievable again. */
    token: (result as any)?.token,
  })
}
