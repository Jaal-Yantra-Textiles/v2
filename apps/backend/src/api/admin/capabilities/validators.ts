import { MedusaError } from "@medusajs/framework/utils"
import { z } from "@medusajs/framework/zod"

import { getTechnique, TECHNIQUE_SLUGS } from "../../../modules/partner_capability/lib/techniques"

/** #2596 — "who can do this?" across all partners. At least one filter. */
export const AdminSearchCapabilitiesQuery = z
  .object({
    technique: z.enum(TECHNIQUE_SLUGS).optional(),
    material: z.string().min(1).optional(),
    product_type: z.string().min(1).optional(),
    q: z.string().min(2).optional(),
    quantity: z.coerce.number().int().positive().optional(),
    limit: z.coerce.number().int().positive().max(200).optional(),
  })
  .refine((v) => v.technique || v.material || v.product_type || v.q, {
    message: "Give at least one of technique, material, product_type or q",
  })
export type AdminSearchCapabilitiesQuery = z.infer<typeof AdminSearchCapabilitiesQuery>

/**
 * A recipe preview: ordered steps, e.g.
 * `?steps=handloom_weaving:cotton,block_print,stitching&quantity=200`.
 * Read-only, so GET. `steps` is parsed by `parseRecipeSteps`.
 */
export const AdminPreviewRecipeQuery = z.object({
  steps: z.string().min(1).max(1000),
  quantity: z.coerce.number().int().positive().optional(),
})
export type AdminPreviewRecipeQuery = z.infer<typeof AdminPreviewRecipeQuery>

/** "slug[:material],…" → steps; an unknown slug is a 400, not a silent gap. */
export const parseRecipeSteps = (raw: string) => {
  const steps = raw
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const [technique, material] = part.split(":").map((x) => x.trim())
      return { technique, material: material || undefined }
    })
  if (!steps.length || steps.length > 12) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "Give 1–12 steps")
  }
  const unknown = steps.filter((s) => !getTechnique(s.technique)).map((s) => s.technique)
  if (unknown.length) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `Unknown technique(s): ${unknown.join(", ")}. See GET /admin/capabilities/techniques.`
    )
  }
  return steps
}
