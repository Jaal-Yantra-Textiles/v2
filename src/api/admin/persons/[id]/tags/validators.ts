import { z } from "zod";

export const tagSchema = z.object({
  name: z.array(z.string().min(1, "Tag value is required")),
});

export const deleteTagSchema = z.object({
  tagId: z.array(z.string().min(1, "Tag ID is required")),
});

export const updateTagSchema = z.object({
  name: z.array(z.string().min(1, "Tag value is required")),
});

export type UpdateTagsForPerson = z.infer<typeof updateTagSchema>;

export type DeleteTagForPerson = z.infer<typeof deleteTagSchema>;


