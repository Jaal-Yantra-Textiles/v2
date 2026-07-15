import { z } from "zod";

/**
 * Validation schemas for the /admin/person-properties CRUD routes.
 * Mirrors the person_property model (models/person_property.ts).
 */

export const CreatePersonPropertySchema = z.object({
  profile_type: z.string().optional().default("weaver"),
  census_id: z.string().nullish(),
  relation_to_head: z.string().nullish(),
  gender: z.string().nullish(),
  social_group: z.string().nullish(),
  religion: z.string().nullish(),
  region_state: z.string().nullish(),
  district: z.string().nullish(),
  own_looms: z.boolean().nullish(),
  total_looms_owned: z.number().int().nullish(),
  natural_dye_used: z.boolean().nullish(),
  sells_local_market: z.boolean().nullish(),
  sells_master_weaver: z.boolean().nullish(),
  sells_cooperative: z.boolean().nullish(),
  sells_ecommerce: z.boolean().nullish(),
  support_requirements: z.array(z.string()).nullish(),
  metadata: z.record(z.string(), z.unknown()).nullish(),
});

// Update: every field optional (partial). profile_type has no default here so an
// omitted value doesn't silently reset it.
export const UpdatePersonPropertySchema = CreatePersonPropertySchema.partial().extend({
  profile_type: z.string().optional(),
});

export type CreatePersonPropertyInput = z.infer<typeof CreatePersonPropertySchema>;
export type UpdatePersonPropertyInput = z.infer<typeof UpdatePersonPropertySchema>;

// Equality-filterable query fields for GET list (the ones the Hyperbee DAL also
// indexes, plus census_id).
export const LIST_FILTER_FIELDS = [
  "profile_type",
  "census_id",
  "gender",
  "social_group",
  "religion",
  "region_state",
  "district",
] as const;
