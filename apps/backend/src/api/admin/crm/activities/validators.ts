import { z } from "zod";

// The vocabulary is owned by `modules/crm/activity` — the leaf the Hyperbee
// contract itself imports. Restating it here would be a second copy free to
// drift from the store that actually rejects the write.
import {
  CRM_ACTIVITY_CHANNELS,
  CRM_ACTIVITY_DIRECTIONS,
  CRM_ACTIVITY_OUTCOMES,
  CRM_ACTIVITY_RELATED_TYPES,
  CRM_ACTIVITY_TYPES,
} from "../../../../modules/crm/activity";

export const CreateCrmActivitySchema = z.object({
  related_type: z.enum(CRM_ACTIVITY_RELATED_TYPES),
  related_id: z.string().min(1),
  activity_type: z.enum(CRM_ACTIVITY_TYPES),
  kind: z.string().nullish(),
  direction: z.enum(CRM_ACTIVITY_DIRECTIONS).optional().default("internal"),
  channel: z.enum(CRM_ACTIVITY_CHANNELS).nullish(),
  subject: z.string().nullish(),
  body: z.string().nullish(),
  summary: z.string().nullish(),
  actor_type: z.enum(["system", "admin", "contact", "flow"]).optional().default("admin"),
  actor_id: z.string().nullish(),
  message_id: z.string().nullish(),
  template_name: z.string().nullish(),
  recipient: z.string().nullish(),
  outcome: z.enum(CRM_ACTIVITY_OUTCOMES).nullish(),
  // Optional so the common case ("this just happened") needs no clock handling
  // in the caller; the service stamps now when it is absent. Present means a
  // deliberate back-date, which is the normal shape for an inbound message
  // recorded after the fact.
  occurred_at: z.string().datetime().nullish(),
  payload: z.record(z.string(), z.unknown()).nullish(),
});

export const UpdateCrmActivitySchema = CreateCrmActivitySchema.partial();

export type CreateCrmActivityInput = z.infer<typeof CreateCrmActivitySchema>;
export type UpdateCrmActivityInput = z.infer<typeof UpdateCrmActivitySchema>;

export const ACTIVITY_LIST_FILTER_FIELDS = [
  "related_type",
  "related_id",
  "direction",
  "channel",
  "activity_type",
] as const;
