import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { DESIGNER_INVITE_MODULE } from "../../../../modules/designer-invite"
import { coreScene } from "../../../../modules/designs/lib/moodboard-ownership"
import { hashInviteToken, isInviteUsable } from "../../../../modules/designer-invite/lib/token"

/**
 * Public (token-as-auth) accept-info for a designer invite (#1113 S1). Powers
 * the landing page: renders the design brief as a read-only preview before the
 * recipient accepts. No partner session required — possession of the token IS
 * the capability (mirrors /partners/wa-auth).
 *
 * @route GET /partners/designer-invites/:token
 */
export const GET = async (
  req: MedusaRequest & { params: { token: string } },
  res: MedusaResponse
) => {
  const service: any = req.scope.resolve(DESIGNER_INVITE_MODULE)
  const invite = await service.findByTokenHash(hashInviteToken(req.params.token))

  if (!invite) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, "Invite not found")
  }

  const usable = isInviteUsable(invite, new Date())

  // Only surface the brief once we know the token maps to a real invite.
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data: designs = [] } = await query.graph({
    entity: "design",
    fields: [
      "id",
      "name",
      "description",
      "design_type",
      "moodboard",
      "moodboards.id",
      "moodboards.owner_type",
      "moodboards.partner_id",
      "moodboards.scene",
    ],
    filters: { id: invite.design_id },
  })
  const row = designs[0] || null
  // The core board lives in `design_moodboard` since #2017 and the mint-time
  // seed writes only there; `design.moodboard` is just the legacy fallback.
  // Reading the column alone showed "No moodboard yet" on a seeded board.
  const design = row
    ? {
        id: row.id,
        name: row.name,
        description: row.description,
        design_type: row.design_type,
        moodboard: coreScene(row.moodboards as any, row.moodboard) ?? null,
      }
    : null

  res.json({
    invite: {
      status: invite.status,
      usable,
      email_locked: !!invite.email,
      expires_at: invite.expires_at,
      inviter_name: invite.inviter_name,
    },
    design,
  })
}
