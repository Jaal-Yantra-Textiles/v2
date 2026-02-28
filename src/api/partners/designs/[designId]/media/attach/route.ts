/**
 * @file Partner API route for attaching media to designs
 * @description Provides endpoints for partners to attach media files to their designs in the JYT Commerce platform
 * @module API/Partners/Designs/Media
 */

/**
 * @typedef {Object} MediaFile
 * @property {string} [id] - Optional unique identifier for the media file
 * @property {string} url - The URL or provider key of the media file (e.g., "uploads/2025/09/19/file.jpg")
 * @property {boolean} [isThumbnail=false] - Whether this media file should be used as the thumbnail
 */

/**
 * @typedef {Object} AttachMediaInput
 * @property {MediaFile[]} media_files - Array of media files to attach to the design
 * @property {Object} [metadata] - Additional metadata to associate with the design
 */

/**
 * @typedef {Object} DesignMedia
 * @property {string} id - The unique identifier of the media file
 * @property {string} url - The URL or provider key of the media file
 * @property {boolean} isThumbnail - Whether this media file is the thumbnail
 */

/**
 * @typedef {Object} DesignResponse
 * @property {string} id - The unique identifier of the design
 * @property {DesignMedia[]} media_files - Array of media files attached to the design
 * @property {Object} metadata - Additional metadata associated with the design
 * @property {string} [metadata.thumbnail] - URL of the thumbnail media file if set
 * @property {Date} created_at - When the design was created
 * @property {Date} updated_at - When the design was last updated
 */

/**
 * @typedef {Object} AttachMediaResponse
 * @property {string} message - Success message
 * @property {DesignResponse} design - The updated design with attached media
 */

/**
 * Attach media files to a design
 * @route POST /partners/designs/:designId/media/attach
 * @group Design Media - Operations related to design media files
 * @param {string} designId.path.required - The ID of the design to attach media to
 * @param {AttachMediaInput} request.body.required - Media files and metadata to attach
 * @returns {AttachMediaResponse} 200 - Successfully attached media files
 * @throws {MedusaError} 401 - Partner authentication required
 * @throws {MedusaError} 404 - Design not found for this partner
 * @throws {MedusaError} 400 - Invalid input data
 * @throws {MedusaError} 500 - Failed to attach media
 *
 * @example request
 * POST /partners/designs/design_123456789/media/attach
 * {
 *   "media_files": [
 *     {
 *       "id": "media_987654321",
 *       "url": "uploads/2025/09/19/design-front.jpg",
 *       "isThumbnail": true
 *     },
 *     {
 *       "url": "uploads/2025/09/19/design-back.jpg"
 *     }
 *   ],
 *   "metadata": {
 *     "color": "blue",
 *     "material": "cotton"
 *   }
 * }
 *
 * @example response 200
 * {
 *   "message": "Media attached successfully",
 *   "design": {
 *     "id": "design_123456789",
 *     "media_files": [
 *       {
 *         "id": "media_987654321",
 *         "url": "uploads/2025/09/19/design-front.jpg",
 *         "isThumbnail": true
 *       },
 *       {
 *         "id": "media_111222333",
 *         "url": "uploads/2025/09/18/design-side.jpg",
 *         "isThumbnail": false
 *       },
 *       {
 *         "id": "media_444555666",
 *         "url": "uploads/2025/09/19/design-back.jpg",
 *         "isThumbnail": false
 *       }
 *     ],
 *     "metadata": {
 *       "thumbnail": "uploads/2025/09/19/design-front.jpg",
 *       "color": "blue",
 *       "material": "cotton",
 *       "previousField": "someValue"
 *     },
 *     "created_at": "2023-01-01T00:00:00Z",
 *     "updated_at": "2023-09-19T12:34:56Z"
 *   }
 * }
 */
import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework"
import { MedusaError, ContainerRegistrationKeys } from "@medusajs/framework/utils"
import designPartnersLink from "../../../../../../links/design-partners-link"
import updateDesignWorkflow from "../../../../../../workflows/designs/update-design"
import listSingleDesignsWorkflow from "../../../../../../workflows/designs/list-single-design"
import { getPartnerFromAuthContext } from "../../../../helpers"
import { z } from "@medusajs/framework/zod"

// Payload schema for attaching media to a design
const partnerAttachMediaSchema = z.object({
  media_files: z
    .array(
      z.object({
        id: z.string().optional(),
        // Accept absolute URLs or provider keys (e.g., "uploads/2025/09/19/file.jpg")
        url: z.string().min(1),
        isThumbnail: z.boolean().optional().default(false),
      })
    )
    .min(1),
  metadata: z.record(z.any()).optional(),
})

// POST /partners/designs/:designId/media/attach
// Persists provided media files (URLs) to the design for an authenticated partner
export const POST = async (
  req: AuthenticatedMedusaRequest & { params: { designId: string } },
  res: MedusaResponse
) => {
  // 1) Partner auth
  if (!req.auth_context?.actor_id) {
    return res.status(401).json({ error: "Partner authentication required" })
  }

  const partner = await getPartnerFromAuthContext(req.auth_context, req.scope)
  if (!partner) {
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
    filters: { design_id: designId, partner_id: partner.id },
    pagination: { skip: 0, take: 1 },
  })
  const linkData = (linkResult?.data || [])[0]
  if (!linkData || !linkData.design?.id) {
    return res.status(404).json({ error: "Design not found for this partner" })
  }

  // 3) Validate body
  const parse = partnerAttachMediaSchema.safeParse(req.body)
  if (!parse.success) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, parse.error.errors.map(e => e.message).join(", "))
  }
  const { media_files, metadata } = parse.data

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
  return res.status(200).json({ message: "Media attached successfully", design: updated })
}
