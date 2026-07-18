import { z } from "zod";

const RELATED_TYPES = ["person", "company", "opportunity", "task"] as const;

export const CreateCrmNoteSchema = z.object({
  body: z.string().min(1),
  author: z.string().nullish(),
  related_type: z.enum(RELATED_TYPES).nullish(),
  related_id: z.string().nullish(),
  metadata: z.record(z.string(), z.unknown()).nullish(),
});

export const UpdateCrmNoteSchema = CreateCrmNoteSchema.partial();

export type CreateCrmNoteInput = z.infer<typeof CreateCrmNoteSchema>;
export type UpdateCrmNoteInput = z.infer<typeof UpdateCrmNoteSchema>;

export const NOTE_LIST_FILTER_FIELDS = [
  "related_type",
  "related_id",
] as const;
