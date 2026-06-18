import { z } from "@medusajs/framework/zod"

export const listDesignsQuerySchema = z.object({
  limit: z.string().transform(Number).optional(),
  offset: z.string().transform(Number).optional(),
  status: z.string().optional(),
  // Free-text search forwarded by the partner UI (SDK `query` → `q`). The
  // partner designs list has no DB index for it, so it's matched in-app
  // over the full partner-scoped set (see ./list-filters). #484.
  q: z.string().optional(),
})

export type ListDesignsQuery = z.infer<typeof listDesignsQuerySchema>

// Partner-side design create/update. Mirrors the admin `designSchema`
// wire contract (roadmap #6 — partner design self-serve). Scoping +
// owner attribution is enforced in the handler, not the schema, per
// the partner-API-mirrors-admin convention. `owner_partner_id` is
// intentionally NOT accepted from the body — the handler stamps it
// from the authenticated partner so a partner can't forge ownership.

const designColorSchema = z.object({
  name: z.string(),
  hex_code: z.string(),
  usage_notes: z.string().optional(),
  order: z.number().optional(),
})

const designSizeSetSchema = z.object({
  size_label: z.string(),
  measurements: z.record(z.string(), z.number()),
})

const colorPaletteSchema = z.array(
  z.object({ name: z.string(), code: z.string() })
)

export const PartnerCreateDesignReq = z.object({
  name: z.string().min(1, "Name is required"),
  description: z.string().optional(),
  inspiration_sources: z.array(z.string()).optional(),
  design_type: z
    .enum(["Original", "Derivative", "Custom", "Collaboration"])
    .optional(),
  status: z
    .enum([
      "Conceptual",
      "In_Development",
      "Technical_Review",
      "Sample_Production",
      "Revision",
      "Approved",
      "Rejected",
      "On_Hold",
      "Commerce_Ready",
      "Superseded",
    ])
    .optional(),
  priority: z.enum(["Low", "Medium", "High", "Urgent"]).optional(),
  target_completion_date: z
    .union([z.date(), z.string().datetime()])
    .optional()
    .transform((val) => {
      if (!val) return null
      return val instanceof Date ? val : new Date(val)
    }),
  design_files: z.array(z.string()).optional(),
  thumbnail_url: z.string().url().optional(),
  custom_sizes: z.record(z.string(), z.any()).optional(),
  color_palette: colorPaletteSchema.optional(),
  tags: z.array(z.string()).optional(),
  estimated_cost: z.number().optional(),
  designer_notes: z.string().optional(),
  metadata: z.record(z.string(), z.any()).optional(),
  media_files: z
    .array(
      z.object({
        id: z.string().optional(),
        url: z.string().url(),
        isThumbnail: z.boolean().optional().default(false),
      })
    )
    .optional(),
  moodboard: z.record(z.string(), z.any()).optional(),
  colors: z.array(designColorSchema).optional(),
  size_sets: z.array(designSizeSetSchema).optional(),
})

export const PartnerUpdateDesignReq = PartnerCreateDesignReq.partial()

export type PartnerCreateDesign = z.infer<typeof PartnerCreateDesignReq>
export type PartnerUpdateDesign = z.infer<typeof PartnerUpdateDesignReq>
