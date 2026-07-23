import { z } from "@medusajs/framework/zod"

/**
 * Validators for the design-brief sub-resource (roadmap #604, slice B).
 *
 * The brief lives as typed columns on the `design` model (slice A, PR #653):
 *   concept_theme  text
 *   persona        json   { age_range?, lifestyle?, values?[], pain_points?[] }
 *   competitors    json   [{ name, url?, differentiator? }]
 *   price_point    enum   luxury | mid_market | budget
 *   design_budget  bigNumber (paired with the shared cost_currency column)
 *
 * These are read+written as a whole through this dedicated route so the brief
 * has a self-contained admin contract, distinct from the kitchen-sink design
 * update route.
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

// Section 1 — Aesthetic Anchor: 3–5 keywords defining the look & feel.
const aestheticKeywordsSchema = z.array(z.string().min(1)).max(8)

// Section 3 — one Key Milestone (initial sketches, first revisions, tech specs,
// production-ready samples). `date` is an ISO date string (nullable).
const milestoneSchema = z.object({
  label: z.string().min(1, "Milestone label is required"),
  date: z.string().nullish(),
})

/**
 * POST /admin/designs/:id/brief — replace the whole brief.
 * Every field is optional (the brief is incremental), but unset fields are
 * treated as `null` by the route so POST is a full replace.
 */
export const DesignBriefSchema = z.object({
  concept_theme: z.string().nullish(),
  aesthetic_keywords: aestheticKeywordsSchema.nullish(),
  persona: personaSchema.nullish(),
  competitors: z.array(competitorSchema).nullish(),
  price_point: pricePointSchema.nullish(),
  design_budget: z.number().nonnegative().nullish(),
  // Budget currency reuses the shared cost_currency column (e.g. "inr").
  cost_currency: z.string().nullish(),
  milestones: z.array(milestoneSchema).nullish(),
})

/**
 * PUT /admin/designs/:id/brief — partial update (only provided keys change).
 */
export const UpdateDesignBriefSchema = DesignBriefSchema.partial()

export type DesignBrief = z.infer<typeof DesignBriefSchema>
export type UpdateDesignBrief = z.infer<typeof UpdateDesignBriefSchema>

// The brief columns refetchDesign returns (it always selects "*", so these
// scalar columns come back without extending DesignAllowedFields).
export const DESIGN_BRIEF_FIELDS = [
  "concept_theme",
  "aesthetic_keywords",
  "persona",
  "competitors",
  "price_point",
  "design_budget",
  "cost_currency",
  "milestones",
] as const

/**
 * Pure shaper — pick just the brief fields from a hydrated design record.
 * Exported for unit testing and reuse by GET/POST/PUT so the response shape is
 * identical across all three.
 */
export const pickDesignBrief = (design: Record<string, any> | undefined | null) => {
  if (!design) {
    return null
  }
  return {
    concept_theme: design.concept_theme ?? null,
    aesthetic_keywords: design.aesthetic_keywords ?? null,
    persona: design.persona ?? null,
    competitors: design.competitors ?? null,
    price_point: design.price_point ?? null,
    design_budget:
      design.design_budget === undefined || design.design_budget === null
        ? null
        : Number(design.design_budget),
    cost_currency: design.cost_currency ?? null,
    milestones: design.milestones ?? null,
  }
}
