import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { getPartnerFromAuthContext } from "../helpers"

/**
 * GET /partners/shared-folders
 * Lists folders assigned to persons linked to the authenticated partner.
 */
export const GET = async (req: AuthenticatedMedusaRequest, res: MedusaResponse) => {
  const partner = await getPartnerFromAuthContext(req.auth_context, req.scope)
  if (!partner) {
    return res.status(401).json({ message: "Partner authentication required" })
  }

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  // Get persons linked to this partner
  const { data: partnerData } = await query.graph({
    entity: "partners",
    fields: ["people.id", "people.first_name", "people.last_name"],
    filters: { id: partner.id },
  })

  const people = (partnerData?.[0] as any)?.people || []
  if (!people.length) {
    return res.json({ shared_folders: [] })
  }

  const personIds = people.map((p: any) => p.id)

  // Get folders linked to these persons via person-folder link
  const { data: personData } = await query.graph({
    entity: "person",
    fields: [
      "id",
      "first_name",
      "last_name",
      "folders.id",
      "folders.name",
      "folders.slug",
      "folders.description",
      "folders.path",
      "folders.is_public",
      "folders.media_files.id",
      "folders.media_files.file_name",
      "folders.media_files.original_name",
      "folders.media_files.file_path",
      "folders.media_files.file_type",
      "folders.media_files.mime_type",
      "folders.media_files.file_size",
      "folders.media_files.created_at",
    ],
    filters: { id: personIds },
  })

  // Flatten: collect all unique folders with the person who has access
  const folderMap = new Map<string, any>()
  for (const person of personData || []) {
    const p = person as any
    for (const folder of p.folders || []) {
      if (!folderMap.has(folder.id)) {
        folderMap.set(folder.id, {
          ...folder,
          assigned_persons: [],
        })
      }
      folderMap.get(folder.id).assigned_persons.push({
        id: p.id,
        first_name: p.first_name,
        last_name: p.last_name,
      })
    }
  }

  return res.json({ shared_folders: Array.from(folderMap.values()) })
}
