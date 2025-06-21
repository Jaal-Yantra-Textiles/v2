import { z } from "zod";

export const SocialPlatformSchema = z.object({
  name: z.string(),
  icon_url: z.string().optional(),
  base_url: z.string().optional(),
  api_config: z.record(z.unknown()).optional(),
  posts: z.string().optional(),
});

export type SocialPlatform = z.infer<typeof SocialPlatformSchema>;

export const UpdateSocialPlatformSchema = z.object({
  name: z.string().optional(),
  icon_url: z.string().optional(),
  base_url: z.string().optional(),
  api_config: z.record(z.unknown()).optional(),
  posts: z.string().optional(),
});

export const listSocialPlatformsQuerySchema = z.object({
  q: z.string().optional(),
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

export type ListSocialPlatformsQuery = z.infer<typeof listSocialPlatformsQuerySchema>;

export type UpdateSocialPlatform = z.infer<typeof UpdateSocialPlatformSchema>;
