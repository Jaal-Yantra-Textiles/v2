import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"

import {
  isPreviewLinkUsable,
  loadPreviewDesigns,
  resolvePreviewScope,
} from "../../../../lib/design-preview-links"
import { DESIGNER_INVITE_MODULE } from "../../../../modules/designer-invite"
import { hashInviteToken } from "../../../../modules/designer-invite/lib/token"

/**
 * PUBLIC (token-as-auth) read of a design preview link (#2500): the bundle's
 * designs with each one's core moodboard, read-only. No partner session — the
 * people at a production unit open it from WhatsApp on whatever phone is
 * there. Mirrors GET /partners/designer-invites/:token.
 *
 * A revoked or expired link answers 200 with `usable: false` and NO designs:
 * the page needs to say "this link has expired", and nothing behind the link
 * is shown once it has been withdrawn.
 *
 * @route GET /partners/design-previews/:token
 */
export const GET = async (
  req: MedusaRequest & { params: { token: string } },
  res: MedusaResponse
) => {
  const service: any = req.scope.resolve(DESIGNER_INVITE_MODULE)
  const link = await service.findPreviewLinkByTokenHash(hashInviteToken(req.params.token))
  if (!link) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, "Preview link not found")
  }

  const usable = isPreviewLinkUsable(link, new Date())
  const header = {
    scope: link.scope,
    label: link.label,
    usable,
    expires_at: link.expires_at,
  }
  if (!usable) {
    res.json({ preview: header, designs: [] })
    return
  }

  const resolved = await resolvePreviewScope(req.scope, link.scope, link.scope_id)
  const designs = await loadPreviewDesigns(req.scope, resolved?.lines ?? [])
  res.json({ preview: header, designs })
}
