import { z } from "@medusajs/framework/zod"

export const StoreTryOnReqSchema = z.object({
  // The garment image — either a URL or a base64 data URL
  garment_image_url: z.string().optional(),
  garment_image_base64: z.string().optional(),
  // Face image as base64 data URL (required)
  face_image_base64: z.string(),
  // Garment category for CatVTON
  cloth_type: z.enum(["upper_body", "lower_body", "dress"]).default("upper_body"),
  // Gender for face-swap model
  gender: z.enum(["male", "female"]).default("female"),
  // Optional preset stock-model photo key; if omitted a default is chosen per gender
  model_preset: z.string().optional(),
})

export type StoreTryOnReq = z.infer<typeof StoreTryOnReqSchema>
