import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { z } from "@medusajs/framework/zod"
import { DESIGN_MODULE } from "../../../../../modules/designs"
import { MEDIA_MODULE } from "../../../../../modules/media"

const LinkMediaFolderBody = z.object({
  folder_id: z.string().min(1, "folder_id is required"),
})

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const { id: design_id } = req.params

  const parsed = LinkMediaFolderBody.safeParse((req as any).validatedBody || req.body)
  if (!parsed.success) {
    return res.status(400).json({ message: parsed.error.errors[0].message })
  }

  const { folder_id } = parsed.data
  const remoteLink = req.scope.resolve(ContainerRegistrationKeys.LINK)
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY) as any

  // Dismiss any existing link first (one-to-one — replace)
  try {
    const { data: designs } = await query.graph({
      entity: "design",
      filters: { id: design_id },
      fields: ["folder.id"],
    })
    const existingFolderId = designs?.[0]?.folder?.id
    if (existingFolderId) {
      await remoteLink.dismiss({
        [DESIGN_MODULE]: { design_id },
        [MEDIA_MODULE]: { folder_id: existingFolderId },
      })
    }
  } catch {
    // no existing link, that's fine
  }

  await remoteLink.create({
    [DESIGN_MODULE]: { design_id },
    [MEDIA_MODULE]: { folder_id },
  })

  return res.json({ design_id, folder_id, linked: true })
}

export const DELETE = async (req: MedusaRequest, res: MedusaResponse) => {
  const { id: design_id } = req.params
  const remoteLink = req.scope.resolve(ContainerRegistrationKeys.LINK)
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY) as any

  // Find the currently linked folder so we can dismiss the specific link
  const { data: designs } = await query.graph({
    entity: "design",
    filters: { id: design_id },
    fields: ["folder.id"],
  })

  const folderId = designs?.[0]?.folder?.id
  if (!folderId) {
    return res.json({ design_id, linked: false })
  }

  await remoteLink.dismiss({
    [DESIGN_MODULE]: { design_id },
    [MEDIA_MODULE]: { folder_id: folderId },
  })

  return res.json({ design_id, linked: false })
}
