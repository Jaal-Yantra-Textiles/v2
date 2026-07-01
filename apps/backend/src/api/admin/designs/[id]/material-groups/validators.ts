import { z } from "@medusajs/framework/zod"

// #817 S4 — pin / update a raw_material_group on a design.

export const pinDesignGroupSchema = z.object({
  raw_material_group_id: z.string().min(1, "raw_material_group_id is required"),
  resolved_raw_material_id: z.string().optional(),
  note: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
})
export type PinDesignGroup = z.infer<typeof pinDesignGroupSchema>

export const updateDesignGroupSchema = z.object({
  // null clears a previously-resolved color.
  resolved_raw_material_id: z.string().nullable().optional(),
  note: z.string().nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
})
export type UpdateDesignGroup = z.infer<typeof updateDesignGroupSchema>
