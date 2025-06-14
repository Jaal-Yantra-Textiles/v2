import { z } from "zod";

// TODO: Define the Zod schema based on the SocialPost model
export const SocialPostSchema = z.object({
  platform_id: z.string(),
  post_url: z.string().optional(),
  caption: z.string().optional(),
  status: z.enum(["draft", "scheduled", "posted", "failed", "archived"]),
  scheduled_at: z.coerce.date().optional(),
  posted_at: z.coerce.date().optional(),
  insights: z.record(z.unknown()).optional(),
  media_attachments: z.record(z.unknown()).optional(),
  notes: z.string().optional(),
  error_message: z.string().optional(),
  related_item_type: z.string().optional(),
  related_item_id: z.string().optional(),
});

export type SocialPost = z.infer<typeof SocialPostSchema>;

export const UpdateSocialPostSchema = z.object({
  platform_id: z.string().optional(),
  post_url: z.string().optional(),
  caption: z.string().optional(),
  status: z.enum(["draft", "scheduled", "posted", "failed", "archived"]).optional(),
  scheduled_at: z.coerce.date().optional(),
  posted_at: z.coerce.date().optional(),
  insights: z.record(z.unknown()).optional(),
  media_attachments: z.record(z.unknown()).optional(),
  notes: z.string().optional(),
  error_message: z.string().optional(),
  related_item_type: z.string().optional(),
  related_item_id: z.string().optional(),
});

export type UpdateSocialPost = z.infer<typeof UpdateSocialPostSchema>;
