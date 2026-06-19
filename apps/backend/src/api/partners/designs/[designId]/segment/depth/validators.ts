import { z } from "@medusajs/framework/zod"

/**
 * Body validator for partner depth/normal estimation. Mirrors the admin depth
 * route's accepted input (`image_url` OR `image_base64`); the handler enforces
 * "at least one is required" via `parseDepthInput`.
 */
export const DepthImageSchema = z.object({
  image_url: z.string().optional(),
  image_base64: z.string().optional(),
})

export type DepthImageReq = z.infer<typeof DepthImageSchema>
