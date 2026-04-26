import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { getPartnerFromAuthContext } from "../../helpers"

/**
 * GET /partners/shared-folders/:folderId
 * Get a specific shared folder with its media files (only if partner has access).
 */
export const GET = async (req: AuthenticatedMedusaRequest, res: MedusaResponse) => {
  const partner = await getPartnerFromAuthContext(req.auth_context, req.scope)
  if (!partner) {
    return res.status(401).json({ message: "Partner authentication required" })
  }

  const folderId = req.params.folderId
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  // Verify access: check partner -> person -> folder link
  const hasAccess = await verifyFolderAccess(query, partner.id, folderId)
  if (!hasAccess) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, "Folder not found")
  }

  // Fetch folder with media files and comments
  const { data: folders } = await query.graph({
    entity: "folder",
    fields: [
      "*",
      "media_files.*",
      "media_files.comments.*",
    ],
    filters: { id: folderId },
  })

  const folder = folders?.[0]
  if (!folder) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, "Folder not found")
  }

  return res.json({ shared_folder: folder })
}

export async function verifyFolderAccess(
  query: any,
  partnerId: string,
  folderId: string
): Promise<boolean> {
  const { data: partnerData } = await query.graph({
    entity: "partners",
    fields: ["people.id", "people.folders.id"],
    filters: { id: partnerId },
  })

  const people = (partnerData?.[0] as any)?.people || []
  for (const person of people) {
    const folders = person.folders || []
    if (folders.some((f: any) => f.id === folderId)) {
      return true
    }
  }
  return false
}
