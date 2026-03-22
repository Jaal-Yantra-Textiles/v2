import { z } from "@medusajs/framework/zod"

export const SegmentImageSchema = z.object({
  image_url: z.string().optional(),
  image_base64: z.string().optional(),
  model: z
    .enum([
      "General Use (Light)",
      "General Use (Heavy)",
      "General Use (Dynamic)",
      "General Use (Light 2K)",
      "Portrait",
      "Matting",
    ])
    .default("General Use (Light)"),
})

export type SegmentImageReq = z.infer<typeof SegmentImageSchema>
