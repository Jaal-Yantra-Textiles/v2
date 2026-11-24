import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"

import { PARTNER_QUOTE_MODULE } from "../../../../../modules/partner-quote"
import { resolveBriefBuyerLink } from "../../../../../modules/partner-quote/lib/brief-link"
import { generateQuoteToken, quoteExpiryFrom } from "../../../../../modules/partner-quote/lib/token"

/**
 * Mint the buyer's link for a brief (#2608 S1).
 *
 * The raw token is returned ONCE and never stored (sha256 only, as quotes do).
 * Opening again replaces the token: the old link stops working. Sends no
 * email; the admin forwards the URL.
 */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const service: any = req.scope.resolve(PARTNER_QUOTE_MODULE)
  const brief = await service.retrievePartnerQuoteBrief(req.params.id).catch(() => null)
  if (!brief) throw new MedusaError(MedusaError.Types.NOT_FOUND, "Brief not found")
  if (brief.status === "closed") {
    throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "A closed brief cannot be reopened.")
  }

  const { raw, hash } = generateQuoteToken()
  const url = await resolveBriefBuyerLink(req.scope, {
    partner_id: brief.partner_id,
    destination_country_code: brief.destination_country_code,
    token: raw,
  })
  if (!url) {
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      "No buyer link can be built: the lead partner has no provisioned storefront domain."
    )
  }

  const now = new Date()
  const ttl = (req.validatedBody as any)?.ttl_days ?? 60
  await service.updatePartnerQuoteBriefs({
    id: brief.id,
    token_hash: hash,
    status: brief.status === "draft" ? "open" : brief.status,
    opened_at: brief.opened_at ?? now,
    expires_at: quoteExpiryFrom(now, ttl),
  })

  res.json({
    brief_id: brief.id,
    url,
    replaced_previous_link: !!brief.token_hash,
    note: "The link is shown once. Opening again replaces it and the old link stops working.",
  })
}
