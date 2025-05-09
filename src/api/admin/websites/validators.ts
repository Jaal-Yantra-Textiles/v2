import { z } from "zod";

export const websiteSchema = z.object({
  domain: z.string().min(1, "Domain is required"),
  name: z.string().min(1, "Name is required"),
  description: z.string().optional(),
  status: z.enum(["Active", "Inactive", "Maintenance", "Development"]).optional(),
  primary_language: z.string().optional(),
  supported_languages: z.record(z.string(), z.string()).optional(),
  favicon_url: z.string().url().optional(),
  analytics_id: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
});

export const deleteWebsiteSchema = z.object({
  id: z.string().uuid("Invalid ID format"),
});

export const updateWebsiteSchema = z.object({
  domain: z.string().optional(),
  name: z.string().optional(),
  description: z.string().optional(),
  status: z.enum(["Active", "Inactive", "Maintenance", "Development"]).optional(),
  primary_language: z.string().optional(),
  supported_languages: z.record(z.string(), z.string()).optional(),
  favicon_url: z.string().url().optional(),
  analytics_id: z.string().optional(),
  metadata: z.record(z.unknown()).optional().nullish(),
});

export type WebsiteSchema = z.infer<typeof websiteSchema>;
export type DeleteWebsiteSchema = z.infer<typeof deleteWebsiteSchema>;
export type UpdateWebsiteSchema = z.infer<typeof updateWebsiteSchema>;
