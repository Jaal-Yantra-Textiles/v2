import { z } from "zod";

// API Category enum
export const ApiCategorySchema = z.enum([
  "social",
  "payment",
  "shipping",
  "email",
  "sms",
  "analytics",
  "crm",
  "storage",
  "communication",
  "authentication",
  "other",
]);

// Authentication type enum
export const AuthTypeSchema = z.enum([
  "oauth2",
  "oauth1",
  "api_key",
  "bearer",
  "basic",
]);

// Platform status enum
export const PlatformStatusSchema = z.enum([
  "active",
  "inactive",
  "error",
  "pending",
]);

export const SocialPlatformSchema = z.object({
  name: z.string().min(1, "Platform name is required"),
  category: ApiCategorySchema.default("social"),
  auth_type: AuthTypeSchema.default("oauth2"),
  icon_url: z.string().url().optional().nullable(),
  base_url: z.string().url().optional().nullable(),
  description: z.string().optional().nullable(),
  status: PlatformStatusSchema.default("active"),
  api_config: z.record(z.unknown()).optional().nullable(),
  metadata: z.record(z.unknown()).optional().nullable(),
});

export type SocialPlatform = z.infer<typeof SocialPlatformSchema>;

export const UpdateSocialPlatformSchema = z.object({
  name: z.string().min(1).optional(),
  category: ApiCategorySchema.optional(),
  auth_type: AuthTypeSchema.optional(),
  icon_url: z.string().url().optional().nullable(),
  base_url: z.string().url().optional().nullable(),
  description: z.string().optional().nullable(),
  status: PlatformStatusSchema.optional(),
  api_config: z.record(z.unknown()).optional().nullable(),
  metadata: z.record(z.unknown()).optional().nullable(),
});

export const listSocialPlatformsQuerySchema = z.object({
  q: z.string().optional(),
  category: ApiCategorySchema.optional(),
  status: PlatformStatusSchema.optional(),
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
