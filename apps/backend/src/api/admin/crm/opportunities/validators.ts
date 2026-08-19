import { z } from "zod";

// The stage vocabulary is owned by the CRM contract, not restated here — the
// contract is what the standalone node enforces, so a local copy could only
// ever drift out of agreement with the store that actually rejects the write.
import {
  CRM_OPPORTUNITY_DEFAULT_STAGE,
  CRM_OPPORTUNITY_STAGES,
} from "../../../../modules/crm/dal/crm-contracts";

const STAGES = CRM_OPPORTUNITY_STAGES;

export const CreateCrmOpportunitySchema = z.object({
  title: z.string().min(1),
  stage: z.enum(STAGES).optional().default(CRM_OPPORTUNITY_DEFAULT_STAGE),
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
