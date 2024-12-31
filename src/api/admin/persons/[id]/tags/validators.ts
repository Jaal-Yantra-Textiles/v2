import { z } from "zod";

export const tagSchema = z.object({
  name: z.array(z.string().min(1, "Tag value is required")),
});

export const deleteTagSchema = z.object({
  tag_ids: z.array(z.string().min(1, "Tag ID is required")),
});
