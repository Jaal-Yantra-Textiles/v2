import { z } from "@medusajs/framework/zod"

const BulkImportItemSchema = z.object({
  name: z.string().min(1, "Name is required"),
  description: z.string().optional().default(""),
  composition: z.string().optional().default(""),
  color: z.string().optional(),
  unit_of_measure: z
    .enum(["Meter", "Yard", "Kilogram", "Gram", "Piece", "Roll", "Other"])
    .optional()
    .default("Other"),
  media: z.array(z.string()).optional(),
  material_type: z.string().optional(),
})

export const BulkImportSchema = z.object({
  items: z.array(BulkImportItemSchema).min(1, "At least one item is required"),
  stock_location_id: z.string().optional(),
})

export type BulkImportInput = z.infer<typeof BulkImportSchema>
export type BulkImportItemInput = z.infer<typeof BulkImportItemSchema>
