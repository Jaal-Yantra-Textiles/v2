import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { DESIGNER_INVITE_MODULE } from "../../../../../modules/designer-invite"
import { generateInviteToken } from "../../../../../modules/designer-invite/lib/token"
import { AdminCreateDesignerInviteReq } from "./validators"

const PARTNER_PORTAL_URL =
  process.env.PARTNER_PORTAL_URL || "https://partner.jaalyantra.com"

/** Public fields for an invite — never leaks `token_hash`. */
function presentInvite(invite: any) {
  return {
    id: invite.id,
    design_id: invite.design_id,
    email: invite.email,
    status: invite.status,
    role: invite.role,
    expires_at: invite.expires_at,
    inviter_name: invite.inviter_name,
    accepted_partner_id: invite.accepted_partner_id,
    accepted_at: invite.accepted_at,
    created_at: invite.created_at,
  }
}

/**
 * Mint a scoped designer-invite link for a design (#1113 S1). The brand/admin
 * assembles a brief on the design, then invites a designer — the returned URL
 * lands them (even as a brand-new partner) on that design's authoring surface.
 *
 * @route POST /admin/designs/:id/designer-invites
 */
export const POST = async (
  req: AuthenticatedMedusaRequest<AdminCreateDesignerInviteReq> & { params: { id: string } },
  res: MedusaResponse
) => {
  const designId = req.params.id
  const body = req.validatedBody
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  // Design must exist before we mint a link to it.
  const { data: designs = [] } = await query.graph({
    entity: "design",
    fields: ["id", "name"],
    filters: { id: designId },
  })
  if (!designs[0]) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, `Design ${designId} not found`)
  }

  const service: any = req.scope.resolve(DESIGNER_INVITE_MODULE)
  const { raw, hash } = generateInviteToken()

  const expires_at =
    body.expires_in_days != null
      ? new Date(Date.now() + body.expires_in_days * 24 * 60 * 60 * 1000)
      : null

  const [invite] = await service.createDesignerInvites([
    {
      design_id: designId,
      email: body.email ?? null,
      token_hash: hash,
      role: body.role ?? "designer",
      expires_at,
      invited_by: req.auth_context?.actor_id ?? null,
      inviter_name: body.inviter_name ?? null,
      metadata: body.metadata ?? null,
    },
  ])

  const base = PARTNER_PORTAL_URL.replace(/\/$/, "")
  const url = `${base}/designer-invite/${raw}`

  res.status(201).json({ invite: presentInvite(invite), token: raw, url })
}

/**
 * List invites minted for a design.
 * @route GET /admin/designs/:id/designer-invites
 */
export const GET = async (
  req: AuthenticatedMedusaRequest & { params: { id: string } },
  res: MedusaResponse
) => {
  const designId = req.params.id
  const service: any = req.scope.resolve(DESIGNER_INVITE_MODULE)
  const invites = await service.listDesignerInvites({ design_id: designId })
  res.json({ invites: (invites || []).map(presentInvite) })
}
