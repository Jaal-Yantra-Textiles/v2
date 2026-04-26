import { z } from "@medusajs/framework/zod"

export const GenerateDescriptionValidator = z.object({
  imageUrl: z.string().url(),
  // Accept either hint or notes (alias). Both optional; if both present, prefer hint
  hint: z.string().min(1).optional(),
  notes: z.string().min(1).optional(),
  productData: z
    .object({
      designers: z.array(z.string()).optional(),
      modelUsed: z.string().optional(),
      materialType: z.string().optional(),
    })
    .optional(),
})

export type GenerateDescriptionValidator = z.infer<typeof GenerateDescriptionValidator>
