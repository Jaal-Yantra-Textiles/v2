import { z } from "zod";

const STATUS = ["pending", "in_progress", "completed", "cancelled"] as const;
const PRIORITY = ["low", "medium", "high"] as const;
const RELATED_TYPES = ["person", "company", "opportunity"] as const;

export const CreateCrmTaskSchema = z.object({
  title: z.string().min(1),
  description: z.string().nullish(),
  due_date: z.string().datetime().nullish(),
  status: z.enum(STATUS).optional().default("pending"),
  priority: z.enum(PRIORITY).optional().default("medium"),
  assignee_person_id: z.string().nullish(),
  related_type: z.enum(RELATED_TYPES).nullish(),
  related_id: z.string().nullish(),
  metadata: z.record(z.string(), z.unknown()).nullish(),
});

export const UpdateCrmTaskSchema = CreateCrmTaskSchema.partial();

export type CreateCrmTaskInput = z.infer<typeof CreateCrmTaskSchema>;
export type UpdateCrmTaskInput = z.infer<typeof UpdateCrmTaskSchema>;

export const TASK_LIST_FILTER_FIELDS = [
  "assignee_person_id",
  "status",
  "due_date",
] as const;
