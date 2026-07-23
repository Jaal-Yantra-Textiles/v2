import { z } from "zod";

const STAGES = [
  "prospecting",
  "qualification",
  "proposal",
  "negotiation",
  "won",
  "lost",
] as const;

export const CreateCrmOpportunitySchema = z.object({
  title: z.string().min(1),
  stage: z.enum(STAGES).optional().default("prospecting"),
  amount: z.number().nonnegative().nullish(),
  currency: z.string().optional().default("INR"),
  expected_close_date: z.string().datetime().nullish(),
  company_id: z.string().nullish(),
  owner_person_id: z.string().nullish(),
  metadata: z.record(z.string(), z.unknown()).nullish(),
});

export const UpdateCrmOpportunitySchema = CreateCrmOpportunitySchema.partial();

export type CreateCrmOpportunityInput = z.infer<typeof CreateCrmOpportunitySchema>;
export type UpdateCrmOpportunityInput = z.infer<typeof UpdateCrmOpportunitySchema>;

export const OPPORTUNITY_LIST_FILTER_FIELDS = [
  "company_id",
  "stage",
  "owner_person_id",
] as const;
