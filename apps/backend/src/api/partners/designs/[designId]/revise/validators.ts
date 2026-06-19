import { z } from "@medusajs/framework/zod"

/**
 * Partner-side revise-design body schema. Mirrors the admin schema
 * (`/admin/designs/:id/revise`) exactly so the partner wire contract is
 * identical — only the auth/ownership scope differs (enforced in the route).
 */
export const ReviseDesignSchema = z.object({
  revision_notes: z.string().min(1, "Revision notes are required"),
  overrides: z
    .object({
      name: z.string().optional(),
      description: z.string().optional(),
      priority: z.enum(["Low", "Medium", "High", "Urgent"]).optional(),
      designer_notes: z.string().optional(),
      tags: z.array(z.string()).optional(),
      target_completion_date: z
        .union([z.date(), z.string().datetime()])
        .optional()
        .transform((val) => {
          if (!val) return undefined
          return val instanceof Date ? val : new Date(val)
        }),
    })
    .optional(),
})

export type ReviseDesignInput = z.infer<typeof ReviseDesignSchema>
