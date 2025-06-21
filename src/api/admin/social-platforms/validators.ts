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

export type UpdateSocialPlatform = z.infer<typeof UpdateSocialPlatformSchema>;
