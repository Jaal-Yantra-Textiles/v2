import { z } from "@medusajs/framework/zod"

/**
 * What a human can correct on a `textile_analysis` row.
 *
 * The FILTER columns (`cloth_type`, `pattern`, `fabric_weight`,
 * `weave_or_knit`, `primary_color`) are what a search branches on, so the
 * route lowercases/trims them — the same discipline `normalise.ts` applies to
 * extractor payloads, so a hand-correction and a model output compare equal.
 * The prose (`title`, `description`, `target_audience`) is only trimmed.
 */

export const TEXTILE_ANALYSIS_SOURCE_ENUM = [
  "internal_extraction",
  "storefront_reference",
  "partner_upload",
  "manual",
] as const

const strOrNull = z.string().trim().optional().nullable()
const strArrayOrNull = z.array(z.string()).optional().nullable()

export const AdminUpdateTextileAnalysisSchema = z.object({
  source: z.enum(TEXTILE_ANALYSIS_SOURCE_ENUM).optional(),
  confidence: z.number().min(0).max(1).optional().nullable(),
  cloth_type: strOrNull,
  category: strOrNull,
  pattern: strOrNull,
  fabric_weight: strOrNull,
  weave_or_knit: strOrNull,
  primary_color: strOrNull,
  title: strOrNull,
  description: strOrNull,
  target_audience: strOrNull,
  colors: strArrayOrNull,
  season: strArrayOrNull,
  occasion: strArrayOrNull,
  care_instructions: strArrayOrNull,
})

export type AdminUpdateTextileAnalysisInput = z.infer<
  typeof AdminUpdateTextileAnalysisSchema
>