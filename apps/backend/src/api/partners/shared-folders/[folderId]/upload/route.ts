import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { getPartnerFromAuthContext } from "../../../helpers"
import { verifyFolderAccess } from "../route"
import { finalizeS3MediaWorkflow } from "../../../../../workflows/media/finalize-s3-media"

/**
 * POST /partners/shared-folders/:folderId/upload
 * Complete an S3 upload and register the media file in the shared folder.
 *
 * Body: { key, url, filename, mimeType, size, metadata? }
 * (Called after the standard /partners/medias/uploads/* flow completes)
 */
export const POST = async (req: AuthenticatedMedusaRequest, res: MedusaResponse) => {
  const partner = await getPartnerFromAuthContext(req.auth_context, req.scope)
  if (!partner) {
    return res.status(401).json({ message: "Partner authentication required" })
  }

  const folderId = req.params.folderId
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  // Verify access
  const hasAccess = await verifyFolderAccess(query, partner.id, folderId)
  if (!hasAccess) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, "Folder not found")
  }

  const body = (req as any).validatedBody || req.body
  const { key, url, filename, mimeType, size, metadata } = body as {
    key: string
    url: string
    filename: string
    mimeType: string
    size: number
    metadata?: Record<string, any>
  }

  if (!key || !url || !filename || !mimeType || !size) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Missing required fields: key, url, filename, mimeType, size"
    )
  }

  // Register the uploaded file in the media module, linked to this folder
  const { result } = await finalizeS3MediaWorkflow(req.scope).run({
    input: {
      files: [{ key, url, filename, mimeType, size }],
      existingFolderId: folderId,
      metadata: {
        ...metadata,
        uploaded_by_partner_id: partner.id,
        uploaded_by_partner_name: partner.name,
      },
    },
  })

  return res.status(201).json({
    message: "File uploaded to shared folder",
    media_file: result.mediaFiles?.[0] || null,
  })
}
