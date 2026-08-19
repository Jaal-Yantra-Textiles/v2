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
  // Scheduling a follow-up is a legitimate manual action ("chase them Tuesday").
  // The DERIVED fields (engagement_state, last_*_at) are deliberately absent:
  // they are a cache of the activity log, and letting a caller set them by hand
  // is what produces a record claiming `awaiting_reply` about somebody who
  // replied last week. Only the service writes those.
  next_follow_up_at: z.string().datetime().nullish(),
  metadata: z.record(z.string(), z.unknown()).nullish(),
});

export const UpdateCrmPersonSchema = CreateCrmPersonSchema.partial();

export type CreateCrmPersonInput = z.infer<typeof CreateCrmPersonSchema>;
export type UpdateCrmPersonInput = z.infer<typeof UpdateCrmPersonSchema>;

export const PERSON_LIST_FILTER_FIELDS = [
  "email",
  "last_name",
  "company_id",
  // The conversation axis. This is the filter flows and the intake board select
  // on ("everyone at follow_up_due"), and a field absent from THIS list is
  // dropped by the route before it ever reaches the store — so the query would
  // silently return every contact rather than erroring.
  "engagement_state",
] as const;
