import { z } from "zod"

const referenceImageSchema = z.object({
  url: z.string().url(),
  weight: z.number().min(0).max(1).default(0.5).optional(),
  prompt: z.string().optional(),
})

const canvasSnapshotSchema = z.object({
  width: z.number().positive(),
  height: z.number().positive(),
  layers: z.array(
    z.object({
      id: z.string(),
      type: z.enum(["image", "text", "shape"]).default("image"),
      data: z.record(z.any()),
    })
  ),
})

const badgeSchema = z.object({
  style: z.string().optional(),
  color_family: z.string().optional(),
  body_type: z.string().optional(),
  embellishment_level: z.string().optional(),
  occasion: z.string().optional(),
  budget_sensitivity: z.string().optional(),
  custom: z.record(z.string(), z.any()).optional(),
})

export const StoreGenerateAiImageReqSchema = z.object({
  design_id: z.string().optional(),
  mode: z.enum(["preview", "commit"]).default("preview"),
  badges: badgeSchema.optional(),
  materials_prompt: z.string().min(3).max(2000).optional(),
  reference_images: z.array(referenceImageSchema).max(3).optional(),
  canvas_snapshot: canvasSnapshotSchema.optional(),
  preview_cache_key: z.string().optional(),
})

export type StoreGenerateAiImageReq = z.infer<typeof StoreGenerateAiImageReqSchema>
