import { z } from "zod"

/**
 * Schema for publishing a social post
 * 
 * All fields are optional - they override values from post.metadata
 */
export const PublishSocialPostSchema = z.object({
  override_page_id: z.string().optional(),
  override_ig_user_id: z.string().optional(),
})

export type PublishSocialPostRequest = z.infer<typeof PublishSocialPostSchema>
