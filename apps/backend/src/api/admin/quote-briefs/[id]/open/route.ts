import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"

import { PARTNER_QUOTE_MODULE } from "../../../../../modules/partner-quote"
import { resolveBriefBuyerLink } from "../../../../../modules/partner-quote/lib/brief-link"
import { generateQuoteToken, quoteExpiryFrom } from "../../../../../modules/partner-quote/lib/token"
import { sendBriefEmailWorkflow } from "../../../../../workflows/email/workflows/send-brief-email"

/**
 * Mint the buyer's link for a brief (#2608 S1).
 *
 * The raw token is returned ONCE and never stored (sha256 only, as quotes do).
 * Opening again replaces the token: the old link stops working. Sends no
 * email unless `email_buyer` is set; then it emails the brief's buyer_email.
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

  // Optional email. A failed send never loses the link: it is returned anyway.
  let email: { sent: boolean; to: string | null; reason: string | null } = { sent: false, to: null, reason: "not requested" }
  if ((req.validatedBody as any)?.email_buyer) {
    const to = String(brief.buyer_email ?? "").trim().toLowerCase()
    if (!to) {
      email = { sent: false, to: null, reason: "The brief has no buyer email." }
    } else {
      try {
        const query: any = req.scope.resolve(ContainerRegistrationKeys.QUERY)
        const { data } = await query.graph({ entity: "partners", fields: ["name"], filters: { id: brief.partner_id } })
        const expires = quoteExpiryFrom(now, ttl)
        await sendBriefEmailWorkflow(req.scope).run({
          input: {
            email: to,
            data: {
              brief_title: brief.title,
              partner_name: (data as any[])[0]?.name?.trim() || "Jaal Yantra Textiles",
              recipient_name: brief.recipient_name || "there",
              brief_url: url,
              sample_quantity: brief.sample_quantity ?? null,
              expires_on: expires.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }),
              current_year: String(now.getUTCFullYear()),
            },
          },
        })
        email = { sent: true, to, reason: null }
        await service.createPartnerQuoteBriefUpdates({
          brief_id: brief.id,
          kind: "note",
          message: "We sent you this brief by email.",
          actor_type: "system",
        })
      } catch (e: any) {
        req.scope.resolve(ContainerRegistrationKeys.LOGGER).error(`[brief] email to ${to} failed for ${brief.id}: ${e?.message ?? e}`)
        email = { sent: false, to, reason: e?.message ?? "Email failed" }
      }
    }
  }

  res.json({
    brief_id: brief.id,
    url,
    email,
    replaced_previous_link: !!brief.token_hash,
    note: "The link is shown once. Opening again replaces it and the old link stops working.",
  })
}
