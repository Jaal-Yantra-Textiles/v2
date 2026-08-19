import { z } from "zod";

export const CreateCrmPersonSchema = z.object({
  first_name: z.string().min(1),
  // Optional, matching crmPersonContract: real lead data routinely carries a
  // single-token name with no surname. Kept `.min(1)` when present so the
  // caller cannot smuggle in an empty string as a stand-in for "unknown".
  last_name: z.string().min(1).nullish(),
  email: z.string().email().nullish(),
  phone: z.string().nullish(),
  title: z.string().nullish(),
  company_id: z.string().nullish(),
  metadata: z.record(z.string(), z.unknown()).nullish(),
});

export const UpdateCrmPersonSchema = CreateCrmPersonSchema.partial();

export type CreateCrmPersonInput = z.infer<typeof CreateCrmPersonSchema>;
export type UpdateCrmPersonInput = z.infer<typeof UpdateCrmPersonSchema>;

export const PERSON_LIST_FILTER_FIELDS = [
  "email",
  "last_name",
  "company_id",
] as const;
