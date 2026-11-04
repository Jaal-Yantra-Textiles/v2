import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"

import {
  presentPreviewLink,
  previewLinkUrl,
  resolvePreviewScope,
} from "../../../lib/design-preview-links"
import { DESIGNER_INVITE_MODULE } from "../../../modules/designer-invite"
import { DESIGN_MODULE } from "../../../modules/designs"
import { generateInviteToken } from "../../../modules/designer-invite/lib/token"
import { AdminCreateDesignPreviewLinkReq } from "./validators"

/**
 * Mint a read-only preview link to a bundle's moodboards (`order_id`) or one
 * design's (`design_id`) — #2500.
 *
 * Nothing is sent: the URL comes back for the admin to check and forward. The
 * raw token is in the response once; only its hash is stored, so a lost link
 * is replaced by minting another, not recovered.
 *
 * @route POST /admin/design-preview-links
 */
export const POST = async (
  req: AuthenticatedMedusaRequest<AdminCreateDesignPreviewLinkReq>,
  res: MedusaResponse
) => {
  const body = req.validatedBody
  const scope = body.order_id ? "order" : "design"
  const scopeId = (body.order_id ?? body.design_id) as string

  const resolved = await resolvePreviewScope(req.scope, scope, scopeId)
  if (!resolved) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, `Order ${scopeId} not found`)
  }
  if (scope === "order" && resolved.lines.length === 0) {
    // A link to a page with nothing on it would read as "the boards are empty".
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `Order ${scopeId} has no designs on it, so there is nothing to preview.`
    )
  }
  if (scope === "design") {
    const service: any = req.scope.resolve(DESIGN_MODULE)
    const design = await service.retrieveDesign(scopeId).catch(() => null)
    if (!design) {
      throw new MedusaError(MedusaError.Types.NOT_FOUND, `Design ${scopeId} not found`)
    }
  }

  const service: any = req.scope.resolve(DESIGNER_INVITE_MODULE)
  const { raw, hash } = generateInviteToken()
  const expires_at =
    body.expires_in_days != null
      ? new Date(Date.now() + body.expires_in_days * 24 * 60 * 60 * 1000)
      : null

  const [link] = await service.createDesignPreviewLinks([
    {
      scope,
      scope_id: scopeId,
      token_hash: hash,
      partner_id: body.partner_id ?? resolved.partner_id ?? null,
      label: body.label ?? resolved.label,
      expires_at,
      created_by: req.auth_context?.actor_id ?? null,
      metadata: body.metadata ?? null,
    },
  ])

  res.status(201).json({
    preview_link: presentPreviewLink(link),
    url: previewLinkUrl(raw),
    design_count: resolved.lines.length,
  })
}

/**
 * Links minted for an order or a design: `?order_id=` or `?design_id=`.
 *
 * @route GET /admin/design-preview-links
 */
export const GET = async (req: AuthenticatedMedusaRequest, res: MedusaResponse) => {
  const q = (req.query ?? {}) as Record<string, unknown>
  const filters: Record<string, unknown> = {}
  if (typeof q.order_id === "string" && q.order_id) {
    filters.scope = "order"
    filters.scope_id = q.order_id
  } else if (typeof q.design_id === "string" && q.design_id) {
    filters.scope = "design"
    filters.scope_id = q.design_id
  }

  const service: any = req.scope.resolve(DESIGNER_INVITE_MODULE)
  const links = await service.listDesignPreviewLinks(filters, {
    order: { created_at: "DESC" },
    take: 100,
  })
  res.json({ preview_links: (links ?? []).map(presentPreviewLink) })
}
