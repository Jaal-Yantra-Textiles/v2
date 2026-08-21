import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import { PARTNER_QUOTE_MODULE } from "../../../modules/partner-quote"
import { mintQuoteWorkflow } from "../../../workflows/partner-quote/mint-quote"
import { getPartnerStore, tryGetPartnerStore } from "../helpers"

/** The partner's own quotes. Scoped by `partner_id`, never listed globally. */
export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const { partner, store } = await tryGetPartnerStore(req.auth_context, req.scope)
  if (!store) {
    return res.json({ quotes: [], count: 0 })
  }

  const service: any = req.scope.resolve(PARTNER_QUOTE_MODULE)
  const quotes = await service.listPartnerQuotes({ partner_id: partner.id })

  res.json({ quotes, count: quotes.length })
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
      ttl_days: body.ttl_days,
      created_by: req.auth_context?.actor_id ?? null,
    },
  })

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
