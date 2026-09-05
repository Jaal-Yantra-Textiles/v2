import { z } from "@medusajs/framework/zod";

export const personSchema = z.object({
  first_name: z.string().min(1, "First name is required"),
  last_name: z.string().min(1, "Last name is required"),
  email: z.string().email("Invalid email address"),
  date_of_birth: z.union([
    z.string()
      .refine((val) => !isNaN(new Date(val).getTime()), {
        message: "Invalid date format"
      })
      .transform(val => new Date(val)),
    z.null(),
    z.undefined()
  ]).optional(), // Optional field that accepts string, null, or undefined
  metadata: z.record(z.string(), z.any()).optional(), // Optional field for additional data
  addresses: z.array(z.any()).optional(),
  state: z.enum(["Onboarding", "Onboarding Finished", "Stalled", "Conflicted"]).optional(),
  avatar: z.string().optional(),
  public_metadata: z.record(z.string(), z.any()).optional(),
});

export const ReadPersonQuerySchema = z.object({
  fields: z.string().optional(),
})
export const UpdatePersonSchema = personSchema.partial();

// Query schema for listing persons
export const listPersonsQuerySchema = z.object({
  fields: z.string().optional(),
  q: z.string().optional(),
  first_name: z.string().optional(),
  last_name: z.string().optional(),
  email: z.string().optional(),
  state: z.enum(["Onboarding", "Onboarding Finished", "Stalled", "Conflicted"]).optional(),
  withDeleted: z.preprocess(
    (val) => val === "true",
    z.boolean().optional().default(false)
  ),
  // Toggle to include census (weavers node) records in the response. When true
  // the route also resolves the `census` module and returns a masked `weavers`
  // array alongside `persons`. See the route for the field mapping.
  include_weavers: z.preprocess(
    (val) => val === "true" || val === true,
    z.boolean().optional().default(false)
  ),
  // Weaver filters (forwarded to the census reader when include_weavers is on).
  // `region_state` is the census record's geographic state — kept distinct from
  // the person lifecycle `state` field above so the two never collide.
  region_state: z.string().optional(),
  district: z.string().optional(),
  block: z.string().optional(),
  village: z.string().optional(),
  gender: z.string().optional(),
  rural_urban: z.string().optional(),
  own_looms: z.string().optional(),
  natural_dye_used: z.string().optional(),
  education: z.string().optional(),
  ownership_type: z.string().optional(),
  household_type: z.string().optional(),
  dwelling_type: z.string().optional(),
  electricity: z.string().optional(),
  offset: z.preprocess(
    (val) => (val !== undefined && val !== null ? Number(val) : undefined),
    z.number().int().min(0).default(0)
  ),
  limit: z.preprocess(
    (val) => (val !== undefined && val !== null ? Number(val) : undefined),
    z.number().int().min(1).max(100).default(20)
  ),
  order: z.string().optional(),
});

export type Person = z.infer<typeof personSchema>;
export type UpdatePerson = z.infer<typeof UpdatePersonSchema>;
export type ListPersonsQuery = z.infer<typeof listPersonsQuerySchema>;
