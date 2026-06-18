import { z } from "@medusajs/framework/zod"

export const panelTypeEnum = z.enum([
  "metric",
  "list",
  "table",
  "bar",
  "line",
  "area",
  "label",
])

export const createDashboardSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  icon: z.string().optional(),
  color: z.string().optional(),
  metadata: z.record(z.string(), z.any()).optional(),
})

export const updateDashboardSchema = createDashboardSchema.partial()

export const listDashboardsQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(200).optional().default(50),
  offset: z.coerce.number().int().nonnegative().optional().default(0),
  q: z.string().optional(),
})

export const panelBaseSchema = z.object({
  name: z.string().min(1),
  type: panelTypeEnum.optional(),
  x: z.number().int().nonnegative().optional(),
  y: z.number().int().nonnegative().optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  operation_type: z.string().min(1),
  operation_options: z.record(z.string(), z.any()).default({}),
  display: z.record(z.string(), z.any()).optional(),
  cache_ttl_seconds: z.number().int().nonnegative().nullable().optional(),
  metadata: z.record(z.string(), z.any()).optional(),
})

export const createPanelSchema = panelBaseSchema

// `panelBaseSchema.partial()` makes every field optional, but a field declared
// with `.default({})` keeps that default even when wrapped in optional — so a
// partial parse of a payload that omits `operation_options` still injects `{}`.
// On the panel PUT route that meant a metadata-only update (e.g. toggling
// `metadata.public`) would re-validate `{}` against the operation's required
// options (400 for operations with required params) and clobber the stored
// options with an empty object. Override the field back to a plain optional so
// an omitted `operation_options` stays `undefined` and the route falls back to
// the existing stored value.
export const updatePanelSchema = panelBaseSchema.partial().extend({
  operation_options: z.record(z.string(), z.any()).optional(),
})

export const previewPanelSchema = z.object({
  operation_type: z.string().min(1),
  operation_options: z.record(z.string(), z.any()).default({}),
  display: z.record(z.string(), z.any()).optional(),
})
