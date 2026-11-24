import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"

import { PARTNER_QUOTE_MODULE } from "../../../../../modules/partner-quote"
import { buildBriefView } from "../../../../../modules/partner-quote/lib/brief-view"

/**
 * Post an update the buyer sees on the same link: sample progress, photos of
 * the sample pieces, a confirmed price. Sends nothing by itself.
 */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const service: any = req.scope.resolve(PARTNER_QUOTE_MODULE)
  const brief = await service.retrievePartnerQuoteBrief(req.params.id).catch(() => null)
  if (!brief) throw new MedusaError(MedusaError.Types.NOT_FOUND, "Brief not found")
  const body = req.validatedBody as { kind?: string; message: string; media_urls?: string[] }
  await service.createPartnerQuoteBriefUpdates({
    brief_id: brief.id,
    kind: body.kind ?? "note",
    message: body.message,
    media_urls: body.media_urls?.length ? body.media_urls : null,
    actor_type: "admin",
    actor_id: (req as any).auth_context?.actor_id ?? null,
  })
  res.status(201).json({ brief: await buildBriefView(req.scope, brief.id, { audience: "admin" }) })
}
