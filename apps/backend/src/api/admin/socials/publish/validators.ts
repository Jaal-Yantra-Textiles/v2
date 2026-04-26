import { z } from "@medusajs/framework/zod"

export const PublishContentSchema = z.object({
  platform: z.enum(["facebook", "instagram", "both"]),
  pageId: z.string().optional(),
  igUserId: z.string().optional(),
  userAccessToken: z.string().min(1, "User access token is required"),
  content: z.object({
    type: z.enum(["photo", "video", "text", "reel"]),
    message: z.string().optional(),
    caption: z.string().optional(),
    image_url: z.string().url().optional(),
    video_url: z.string().url().optional(),
    link: z.string().url().optional(),
  }),
}).refine(
  (data) => {
    // If platform is facebook or both, pageId is required
    if (data.platform === "facebook" || data.platform === "both") {
      return !!data.pageId
    }
    return true
  },
  {
    message: "Page ID is required when publishing to Facebook",
    path: ["pageId"],
  }
).refine(
  (data) => {
    // If platform is instagram or both, igUserId is required
    if (data.platform === "instagram" || data.platform === "both") {
      return !!data.igUserId
    }
    return true
  },
  {
    message: "Instagram User ID is required when publishing to Instagram",
    path: ["igUserId"],
  }
).refine(
  (data) => {
    // Photo posts require image_url
    if (data.content.type === "photo") {
      return !!data.content.image_url
    }
    return true
  },
  {
    message: "Image URL is required for photo posts",
    path: ["content", "image_url"],
  }
).refine(
  (data) => {
    // Video/reel posts require video_url
    if (data.content.type === "video" || data.content.type === "reel") {
      return !!data.content.video_url
    }
    return true
  },
  {
    message: "Video URL is required for video/reel posts",
    path: ["content", "video_url"],
  }
).refine(
  (data) => {
    // Text posts require message
    if (data.content.type === "text") {
      return !!data.content.message
    }
    return true
  },
  {
    message: "Message is required for text posts",
    path: ["content", "message"],
  }
)

export type PublishContentRequest = z.infer<typeof PublishContentSchema>
