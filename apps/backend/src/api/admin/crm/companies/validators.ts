import { z } from "zod";

export const CreateCrmCompanySchema = z.object({
  name: z.string().min(1),
  website: z.string().nullish(),
  industry: z.string().nullish(),
  size: z.string().nullish(),
  region: z.string().nullish(),
  metadata: z.record(z.string(), z.unknown()).nullish(),
});

export const UpdateCrmCompanySchema = CreateCrmCompanySchema.partial();

export type CreateCrmCompanyInput = z.infer<typeof CreateCrmCompanySchema>;
export type UpdateCrmCompanyInput = z.infer<typeof UpdateCrmCompanySchema>;

export const COMPANY_LIST_FILTER_FIELDS = [
  "name",
  "industry",
  "region",
] as const;
