import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { PERSON_MODULE } from "../../../../../../modules/person"
import { MEDIA_MODULE } from "../../../../../../modules/media"

/**
 * POST /admin/medias/folders/:folderId/assign-persons
 * Assign persons to a media folder so they can upload and comment via partner UI.
 * Body: { person_ids: string[] }
 */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const { folderId } = req.params
  const body = (req as any).validatedBody || req.body
  const personIds = body?.person_ids as string[]

  if (!Array.isArray(personIds) || !personIds.length) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "person_ids array is required")
  }

  const remoteLink = req.scope.resolve(ContainerRegistrationKeys.LINK)

  // Create links for each person -> folder
  for (const personId of personIds) {
    await remoteLink.create({
      [PERSON_MODULE]: { person_id: personId },
      [MEDIA_MODULE]: { folder_id: folderId },
    })
  }

  return res.json({
    folder_id: folderId,
    person_ids: personIds,
    assigned: true,
  })
}

/**
 * DELETE /admin/medias/folders/:folderId/assign-persons
 * Unassign persons from a media folder.
 * Body: { person_ids: string[] }
 */
export const DELETE = async (req: MedusaRequest, res: MedusaResponse) => {
  const { folderId } = req.params
  const body = (req as any).validatedBody || req.body
  const personIds = body?.person_ids as string[]

  if (!Array.isArray(personIds) || !personIds.length) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "person_ids array is required")
  }

  const remoteLink = req.scope.resolve(ContainerRegistrationKeys.LINK)

  for (const personId of personIds) {
    await remoteLink.dismiss({
      [PERSON_MODULE]: { person_id: personId },
      [MEDIA_MODULE]: { folder_id: folderId },
    })
  }

  return res.json({
    folder_id: folderId,
    person_ids: personIds,
    assigned: false,
  })
}

/**
 * GET /admin/medias/folders/:folderId/assign-persons
 * List persons assigned to a folder.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const { folderId } = req.params
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  const { data: folders } = await query.graph({
    entity: "folder",
    fields: ["id", "name"],
    filters: { id: folderId },
  })

  if (!folders?.length) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, "Folder not found")
  }

  // Get persons linked to this folder via the person-folder link
  // Query from person side since isList is on person -> folders
  const { data: persons } = await query.graph({
    entity: "person",
    fields: ["id", "first_name", "last_name", "email", "folders.id"],
    filters: {},
  })

  // Filter persons who have this folder linked
  const assignedPersons = (persons || []).filter((p: any) =>
    (p.folders || []).some((f: any) => f.id === folderId)
  )

  return res.json({
    folder_id: folderId,
    persons: assignedPersons.map((p: any) => ({
      id: p.id,
      first_name: p.first_name,
      last_name: p.last_name,
      email: p.email,
    })),
  })
}
