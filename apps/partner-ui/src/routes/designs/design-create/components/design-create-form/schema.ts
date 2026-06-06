import { z } from "@medusajs/framework/zod"

export const CreateDesignSchema = z.object({
  name: z.string().min(1, "Name is required"),
  description: z.string().optional(),
  design_type: z
    .enum(["Original", "Derivative", "Custom", "Collaboration"])
    .optional(),
  priority: z.enum(["Low", "Medium", "High", "Urgent"]).optional(),
  status: z
    .enum([
      "Conceptual",
      "In_Development",
      "Technical_Review",
      "Sample_Production",
      "Revision",
      "Approved",
      "On_Hold",
      "Commerce_Ready",
    ])
    .optional(),
  designer_notes: z.string().optional(),
})

export type CreateDesignSchema = z.infer<typeof CreateDesignSchema>
