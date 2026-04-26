import { z } from "@medusajs/framework/zod"

export const PublishBothPlatformsSchema = z.object({
  post_id: z.string().min(1, "Post ID is required"),
})

export type PublishBothPlatformsRequest = z.infer<typeof PublishBothPlatformsSchema>
