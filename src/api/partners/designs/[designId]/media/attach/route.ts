import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework"
import { MedusaError, ContainerRegistrationKeys } from "@medusajs/framework/utils"
import designPartnersLink from "../../../../../../links/design-partners-link"
import updateDesignWorkflow from "../../../../../../workflows/designs/update-design"
import listSingleDesignsWorkflow from "../../../../../../workflows/designs/list-single-design"
import { refetchPartnerForThisAdmin } from "../../../../helpers"
import { z } from "zod"
// Payload schema for attaching media to a design
const partnerAttachMediaSchema = z.object({
  media_files: z.array(
    z.object({
      id: z.string().optional(),
      url: z.string().url(),
      isThumbnail: z.boolean().optional().default(false),
    })
  ).min(1),
  metadata: z.record(z.any()).optional(),
})

// POST /partners/designs/:designId/media/attach
// Persists provided media files (URLs) to the design for an authenticated partner
export const POST = async (
  req: AuthenticatedMedusaRequest & { params: { designId: string } },
  res: MedusaResponse
) => {
  // 1) Partner auth
  const adminId = req.auth_context?.actor_id
  const partnerAdmin = await refetchPartnerForThisAdmin(adminId, req.scope)
  console.log("[partners/designs/:designId/media/attach] auth", { adminId, partnerFound: !!partnerAdmin, partnerId: partnerAdmin?.id })
  if (!partnerAdmin) {
    return res.status(401).json({ error: "Partner authentication required" })
  }

  const { designId } = req.params || ({} as any)
  if (!designId) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "Design ID is required")
  }

  // 2) Verify this design is linked to this partner via link graph
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const linkResult = await query.graph({
    entity: designPartnersLink.entryPoint,
    fields: ["design.id", "partner.id"],
    filters: { design_id: designId, partner_id: partnerAdmin.id },
    pagination: { skip: 0, take: 1 },
  })
  const linkData = (linkResult?.data || [])[0]
  console.log("[partners/designs/:designId/media/attach] linkResult", { designId, partnerId: partnerAdmin.id, linkData })
  if (!linkData || !linkData.design?.id) {
    return res.status(404).json({ error: "Design not found for this partner" })
  }

  // 3) Validate body
  const parse = partnerAttachMediaSchema.safeParse(req.body)
  if (!parse.success) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, parse.error.errors.map(e => e.message).join(", "))
  }
  const { media_files, metadata } = parse.data
  console.log("[partners/designs/:designId/media/attach] payload", { count: media_files?.length, media_files, metadata })

  // Derive thumbnail metadata if any media file marked as thumbnail
  const thumbnail = media_files.find(m => m.isThumbnail)?.url
  const mergedMeta = thumbnail ? { ...(metadata || {}), thumbnail } : (metadata || {})

  // 4) Merge with existing media files and preserve metadata
  const { result: currentDesign } = await listSingleDesignsWorkflow(req.scope).run({
    input: { id: designId, fields: ["*"] },
  })

  const existingMedia = Array.isArray(currentDesign?.media_files) ? currentDesign.media_files : []
  const existingMeta = (currentDesign?.metadata as Record<string, any> | undefined) || {}

  // Merge arrays and de-duplicate by id or url
  const byKey = new Map<string, any>()
  const keyOf = (m: any) => (m?.id ? `id:${m.id}` : m?.url ? `url:${m.url}` : Math.random().toString(36))
  for (const m of existingMedia) {
    byKey.set(keyOf(m), m)
  }
  for (const m of media_files) {
    byKey.set(keyOf(m), { ...m })
  }
  let mergedMedia = Array.from(byKey.values())

  // If a new thumbnail is provided, enforce single isThumbnail true
  if (thumbnail) {
    mergedMedia = mergedMedia.map((m) => ({ ...m, isThumbnail: m?.url === thumbnail }))
  }

  const nextMetadata = { ...existingMeta, ...mergedMeta }

  const { result, errors } = await updateDesignWorkflow(req.scope).run({
    input: {
      id: designId,
      media_files: mergedMedia,
      metadata: nextMetadata,
    },
  })
  if (errors.length > 0) {
    throw new MedusaError(
      MedusaError.Types.UNEXPECTED_STATE,
      `Failed to attach media: ${errors.map(e => e.error?.message || "Unknown error").join(", ")}`
    )
  }

  // Refetch the updated design for confirmation
  const { result: updated } = await listSingleDesignsWorkflow(req.scope).run({
    input: { id: designId, fields: ["*"] },
  })
  console.log("[partners/designs/:designId/media/attach] updated design", { hasMedia: Array.isArray(updated?.media_files) && updated.media_files.length })
  return res.status(200).json({ message: "Media attached successfully", design: updated })
}
