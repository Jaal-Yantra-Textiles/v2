import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { MEDIA_MODULE } from "../../../../../modules/media"

/**
 * GET /admin/medias/:id/comments
 * List comments on a media file.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const { id: mediaId } = req.params
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  const { data: comments } = await query.graph({
    entity: "media_comment",
    fields: ["*"],
    filters: { media_file_id: mediaId },
  })

  return res.json({ comments: comments || [] })
}

/**
 * POST /admin/medias/:id/comments
 * Add a comment to a media file (from admin).
 * Body: { content: string }
 */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const { id: mediaId } = req.params
  const body = (req as any).validatedBody || req.body
  const content = body?.content as string

  if (!content?.trim()) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "Comment content is required")
  }

  // Get admin user info from auth context
  const authContext = (req as any).auth_context
  const authorId = authContext?.actor_id || "admin"
  const authorName = "Admin"

  const mediaService: any = req.scope.resolve(MEDIA_MODULE)
  const comment = await mediaService.createMediaComments({
    content: content.trim(),
    author_type: "admin",
    author_id: authorId,
    author_name: authorName,
    media_file_id: mediaId,
  })

  return res.status(201).json({ comment })
}
