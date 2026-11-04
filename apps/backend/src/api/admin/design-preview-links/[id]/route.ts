import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"

import { presentPreviewLink } from "../../../../lib/design-preview-links"
import { DESIGNER_INVITE_MODULE } from "../../../../modules/designer-invite"

/**
 * Revoke a preview link: the page stops showing the designs at once. Revoking
 * twice keeps the first revocation time.
 *
 * @route DELETE /admin/design-preview-links/:id
 */
export const DELETE = async (
  req: AuthenticatedMedusaRequest & { params: { id: string } },
  res: MedusaResponse
) => {
  const service: any = req.scope.resolve(DESIGNER_INVITE_MODULE)
  const link = await service.retrieveDesignPreviewLink(req.params.id).catch(() => null)
  if (!link) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, `Preview link ${req.params.id} not found`)
  }

  const updated = link.revoked_at
    ? link
    : await service.updateDesignPreviewLinks({ id: link.id, revoked_at: new Date() })

  res.json({ preview_link: presentPreviewLink(updated), revoked: true })
}
