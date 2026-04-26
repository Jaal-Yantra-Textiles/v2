import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { MEDIA_MODULE } from "../../../../../../../modules/media"
import { getPartnerFromAuthContext } from "../../../../../helpers"
import { verifyFolderAccess } from "../../../route"

/**
 * GET /partners/shared-folders/:folderId/media/:mediaId/comments
 * List comments on a media file in a shared folder.
 */
export const GET = async (req: AuthenticatedMedusaRequest, res: MedusaResponse) => {
  const partner = await getPartnerFromAuthContext(req.auth_context, req.scope)
  if (!partner) {
    return res.status(401).json({ message: "Partner authentication required" })
  }

  const { folderId, mediaId } = req.params
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  const hasAccess = await verifyFolderAccess(query, partner.id, folderId)
  if (!hasAccess) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, "Folder not found")
  }

  // Verify media belongs to folder
  const { data: mediaFiles } = await query.graph({
    entity: "media_file",
    fields: ["id", "folder.id"],
    filters: { id: mediaId },
  })
  const media = mediaFiles?.[0] as any
  if (!media || media.folder?.id !== folderId) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, "Media file not found in this folder")
  }

  // List comments
  const { data: comments } = await query.graph({
    entity: "media_comment",
    fields: ["*"],
    filters: { media_file_id: mediaId },
  })

  return res.json({ comments: comments || [] })
}

/**
 * POST /partners/shared-folders/:folderId/media/:mediaId/comments
 * Add a comment to a media file in a shared folder.
 * Body: { content: string }
 */
export const POST = async (req: AuthenticatedMedusaRequest, res: MedusaResponse) => {
  const partner = await getPartnerFromAuthContext(req.auth_context, req.scope)
  if (!partner) {
    return res.status(401).json({ message: "Partner authentication required" })
  }

  const { folderId, mediaId } = req.params
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  const hasAccess = await verifyFolderAccess(query, partner.id, folderId)
  if (!hasAccess) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, "Folder not found")
  }

  // Verify media belongs to folder
  const { data: mediaFiles } = await query.graph({
    entity: "media_file",
    fields: ["id", "folder.id"],
    filters: { id: mediaId },
  })
  const media = mediaFiles?.[0] as any
  if (!media || media.folder?.id !== folderId) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, "Media file not found in this folder")
  }

  const body = (req as any).validatedBody || req.body
  const content = body?.content as string
  if (!content?.trim()) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "Comment content is required")
  }

  // Get the partner admin name for author_name
  const admins = partner.admins || []
  const adminName = admins.length
    ? `${admins[0].first_name || ""} ${admins[0].last_name || ""}`.trim()
    : partner.name

  const mediaService: any = req.scope.resolve(MEDIA_MODULE)
  const comment = await mediaService.createMediaComments({
    content: content.trim(),
    author_type: "partner",
    author_id: partner.id,
    author_name: adminName,
    media_file_id: mediaId,
  })

  return res.status(201).json({ comment })
}
