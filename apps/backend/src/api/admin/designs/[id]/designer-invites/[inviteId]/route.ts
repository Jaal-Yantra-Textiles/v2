import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { DESIGNER_INVITE_MODULE } from "../../../../../../modules/designer-invite"

/**
 * Revoke a pending designer invite (idempotent-ish: already-accepted invites
 * can't be revoked — the partner already exists and holds the grant).
 *
 * @route DELETE /admin/designs/:id/designer-invites/:inviteId
 */
export const DELETE = async (
  req: AuthenticatedMedusaRequest & { params: { id: string; inviteId: string } },
  res: MedusaResponse
) => {
  const { id: designId, inviteId } = req.params
  const service: any = req.scope.resolve(DESIGNER_INVITE_MODULE)

  const invite = await service.retrieveDesignerInvite(inviteId).catch(() => null)
  if (!invite || invite.design_id !== designId) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, `Invite ${inviteId} not found`)
  }
  if (invite.status === "accepted") {
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      "Cannot revoke an already-accepted invite."
    )
  }

  await service.updateDesignerInvites({ id: inviteId, status: "revoked" })

  res.json({ id: inviteId, object: "designer_invite", revoked: true })
}
