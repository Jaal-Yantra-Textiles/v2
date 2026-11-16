import { z } from "@medusajs/framework/zod"

/** POST /store/custom/design-assistant/pick — the scene panel's "Build on this". */
export const PickDesignCanvasSchema = z.object({
  design_id: z.string().trim().min(1).max(80),
  canvas_id: z.string().trim().min(1).max(120),
})

export type PickDesignCanvasInput = z.infer<typeof PickDesignCanvasSchema>
