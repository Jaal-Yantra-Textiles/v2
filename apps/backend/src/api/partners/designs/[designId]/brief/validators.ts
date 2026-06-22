import { z } from "@medusajs/framework/zod"

/**
 * Validators for the PARTNER design-brief sub-resource (roadmap #604, slice C).
 *
 * Mirrors the admin brief contract (`/admin/designs/:id/brief`, slice B) so the
 * partner-ui talks to an identical wire shape — only the auth + ownership
 * scoping differs (see route.ts `assertPartnerOwnsDesign`).
 *
 * The brief lives as typed columns on the `design` model (slice A, PR #653):
 *   concept_theme  text
 *   persona        json   { age_range?, lifestyle?, values?[], pain_points?[] }
 *   competitors    json   [{ name, url?, differentiator? }]
 *   price_point    enum   luxury | mid_market | budget
 *   design_budget  bigNumber (paired with the shared cost_currency column)
 */

// Section 2 — Target Audience value object.
const personaSchema = z.object({
  age_range: z.string().optional(),
  lifestyle: z.string().optional(),
  values: z.array(z.string()).optional(),
  pain_points: z.array(z.string()).optional(),
})

// Section 2 — Market positioning: one competitor entry.
const competitorSchema = z.object({
  name: z.string().min(1, "Competitor name is required"),
  url: z.string().url().optional(),
  differentiator: z.string().optional(),
})

const pricePointSchema = z.enum(["luxury", "mid_market", "budget"])

/**
 * POST /partners/designs/:designId/brief — replace the whole brief.
 * Every field is optional (the brief is incremental), but unset fields are
 * treated as `null` by the route so POST is a full replace.
 */
export const DesignBriefSchema = z.object({
  concept_theme: z.string().nullish(),
  persona: personaSchema.nullish(),
  competitors: z.array(competitorSchema).nullish(),
  price_point: pricePointSchema.nullish(),
  design_budget: z.number().nonnegative().nullish(),
  // Budget currency reuses the shared cost_currency column (e.g. "inr").
  cost_currency: z.string().nullish(),
})

/**
 * PUT /partners/designs/:designId/brief — partial update (only provided keys change).
 */
export const UpdateDesignBriefSchema = DesignBriefSchema.partial()

export type DesignBrief = z.infer<typeof DesignBriefSchema>
export type UpdateDesignBrief = z.infer<typeof UpdateDesignBriefSchema>

// The brief columns to read back from a hydrated design record.
export const DESIGN_BRIEF_FIELDS = [
  "concept_theme",
  "persona",
  "competitors",
  "price_point",
  "design_budget",
  "cost_currency",
] as const

/**
 * Pure shaper — pick just the brief fields from a hydrated design record.
 * Exported for unit testing and reuse by GET/POST/PUT so the response shape is
 * identical across all three (and identical to the admin slice-B shape).
 */
export const pickDesignBrief = (
  design: Record<string, any> | undefined | null
) => {
  if (!design) {
    return null
  }
  return {
    concept_theme: design.concept_theme ?? null,
    persona: design.persona ?? null,
    competitors: design.competitors ?? null,
    price_point: design.price_point ?? null,
    design_budget:
      design.design_budget === undefined || design.design_budget === null
        ? null
        : Number(design.design_budget),
    cost_currency: design.cost_currency ?? null,
  }
}
