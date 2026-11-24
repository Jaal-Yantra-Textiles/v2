import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"

import { PARTNER_QUOTE_MODULE } from "../../../../modules/partner-quote"
import { buildBriefView } from "../../../../modules/partner-quote/lib/brief-view"

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const brief = await buildBriefView(req.scope, req.params.id, { audience: "admin" })
  if (!brief) throw new MedusaError(MedusaError.Types.NOT_FOUND, "Brief not found")
  res.json({ brief })
}

/** Title / intro / sample size / status / the quote it became. */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const service: any = req.scope.resolve(PARTNER_QUOTE_MODULE)
  const existing = await service.retrievePartnerQuoteBrief(req.params.id).catch(() => null)
  if (!existing) throw new MedusaError(MedusaError.Types.NOT_FOUND, "Brief not found")
  const body = req.validatedBody as Record<string, unknown>
  if (body.status && body.status !== "draft" && !existing.token_hash) {
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      "This brief has no buyer link yet. Open it (POST /admin/quote-briefs/:id/open) before moving it past draft."
    )
  }
  await service.updatePartnerQuoteBriefs({ id: existing.id, ...body })
  const brief = await buildBriefView(req.scope, existing.id, { audience: "admin" })
  res.json({ brief })
}
