import { z } from "zod";

const colorPaletteSchema = z.array(
  z.object({
    name: z.string(),
    code: z.string(),
  })
);

const feedbackHistorySchema = z.array(
  z.object({
    date: z.union([z.string(), z.date()]),
    feedback: z.string(),
    author: z.string(),
  })
);

export const designSchema = z.object({
  name: z.string().min(1, "Name is required"),
  description: z.string().optional(),
  inspiration_sources: z.array(z.string()).optional(),
  design_type: z.enum(["Original", "Derivative", "Custom", "Collaboration"]).optional(),
  status: z.enum([
    "Conceptual",
    "In_Development",
    "Technical_Review",
    "Sample_Production",
    "Revision",
    "Approved",
    "Rejected",
    "On_Hold"
  ]).optional(),
  priority: z.enum(["Low", "Medium", "High", "Urgent"]).optional(),
  target_completion_date: z.union([z.date(), z.string().datetime()]).optional().transform((val) => {
    if (!val) return null;
    return val instanceof Date ? val : new Date(val);
  }),
  design_files: z.array(z.string()).optional(),
  thumbnail_url: z.string().url().optional(),
  custom_sizes: z.record(z.any()).optional(),
  color_palette: colorPaletteSchema.optional(),
  tags: z.array(z.string()).optional(),
  estimated_cost: z.number().optional(),
  designer_notes: z.string().optional(),
  feedback_history: feedbackHistorySchema.optional(),
  metadata: z.record(z.any()).optional(),
  media_files: z.array(z.object({
    id: z.string().optional(),
    url: z.string().url(),
    isThumbnail: z.boolean().optional().default(false)
  })).optional(),
  moodboard: z.record(z.any()).optional()
});

export const UpdateDesignSchema = designSchema.partial();

export const ReadDesignsQuerySchema = z.object({
  fields: z.string().optional(),
  filters: z.object({}).optional(),
  sort: z.array(z.string()).default(["created_at", "desc"]).optional(),
  limit: z.number().default(20).optional(),
  offset: z.number().default(0).optional(),
})

export const CreateDesignLLMSchema = z.object({
  designPrompt: z.string(),
  existingValues: z.record(z.any()).optional()
});

export type Design = z.infer<typeof designSchema>;
export type UpdateDesign = z.infer<typeof UpdateDesignSchema>;
export type ReadDesigns = z.infer<typeof ReadDesignsQuerySchema>;
export type CreateDesignLLM = z.infer<typeof CreateDesignLLMSchema>;