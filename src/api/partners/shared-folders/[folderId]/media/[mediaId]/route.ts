import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { getPartnerFromAuthContext } from "../../../../helpers"
import { verifyFolderAccess } from "../../route"

/**
 * GET /partners/shared-folders/:folderId/media/:mediaId
 * Get a specific media file with its comments from a shared folder.
 */
export const GET = async (req: AuthenticatedMedusaRequest, res: MedusaResponse) => {
  const partner = await getPartnerFromAuthContext(req.auth_context, req.scope)
  if (!partner) {
    return res.status(401).json({ message: "Partner authentication required" })
  }

  const { folderId, mediaId } = req.params
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  // Verify folder access
  const hasAccess = await verifyFolderAccess(query, partner.id, folderId)
  if (!hasAccess) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, "Folder not found")
  }

  // Fetch media file with comments, verify it belongs to this folder
  const { data: mediaFiles } = await query.graph({
    entity: "media_file",
    fields: ["*", "comments.*", "folder.id"],
    filters: { id: mediaId },
  })

  const media = mediaFiles?.[0] as any
  if (!media || media.folder?.id !== folderId) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, "Media file not found in this folder")
  }

  return res.json({ media_file: media })
}
