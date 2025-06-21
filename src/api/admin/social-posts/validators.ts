import { z } from "zod";

export const SocialPostSchema = z.object({
  name: z.string().min(1, "Name is required"),
  post_url: z.string().optional(),
  caption: z.string().optional(),
  status: z.enum(["draft","scheduled","posted","failed","archived"]).default("draft").optional(),
  scheduled_at: z.coerce.date().optional(),
  posted_at: z.coerce.date().optional(),
  insights: z.record(z.unknown()).optional(),
  media_attachments: z.record(z.unknown()).optional(),
  notes: z.string().optional(),
  error_message: z.string().optional(),
  related_item_type: z.string().optional(),
  related_item_id: z.string().optional(),
  platform_id: z.string(),
});

export type SocialPost = z.infer<typeof SocialPostSchema>;

export const UpdateSocialPostSchema = z.object({
  name: z.string().optional(),
  post_url: z.string().optional(),
  caption: z.string().optional(),
  status: z.enum(["draft","scheduled","posted","failed","archived"]).optional(),
  scheduled_at: z.coerce.date().optional(),
  posted_at: z.coerce.date().optional(),
  insights: z.record(z.unknown()).optional(),
  media_attachments: z.record(z.unknown()).optional(),
  notes: z.string().optional(),
  error_message: z.string().optional(),
  related_item_type: z.string().optional(),
  related_item_id: z.string().optional(),
  platform_id: z.string().optional(),
});

export const listSocialPostsQuerySchema = z.object({
  q: z.string().optional(),
  status: z
    .union([
      z.enum(["draft", "scheduled", "posted", "failed", "archived"]),
      z.array(z.enum(["draft", "scheduled", "posted", "failed", "archived"])),
    ])
    .optional(),
  posted_at: z
    .union([z.string(), z.array(z.string())])
    .optional(), // ISO date string or partial match
  error_message: z.string().optional(),
  offset: z.preprocess(
    (val) => (val !== undefined && val !== null ? Number(val) : undefined),
    z.number().int().min(0).default(0)
  ),
  limit: z.preprocess(
    (val) => (val !== undefined && val !== null ? Number(val) : undefined),
    z.number().int().min(1).max(100).default(20)
  ),
  order: z.string().optional(),
});

export type ListSocialPostsQuery = z.infer<typeof listSocialPostsQuerySchema>;

export type UpdateSocialPost = z.infer<typeof UpdateSocialPostSchema>;
