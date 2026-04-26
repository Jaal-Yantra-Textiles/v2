import { z } from "@medusajs/framework/zod";

// Base EmailTemplate schema
export const EmailTemplateSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1, "Name is required"),
  description: z.string().nullable().optional(),
  to: z.union([z.string().email(), z.literal(""), z.null()]).optional().transform(val => val === "" ? null : val),
  cc: z.union([z.string().email(), z.literal(""), z.null()]).optional().transform(val => val === "" ? null : val),
  bcc: z.union([z.string().email(), z.literal(""), z.null()]).optional().transform(val => val === "" ? null : val),
  from: z.string().email(),
  template_key: z.string(),
  subject: z.string().min(1, "Subject is required"),
  html_content: z.string(),
  variables: z.record(z.unknown()).nullable().optional(),
  is_active: z.boolean().default(true),
  template_type: z.string(),
});

export type EmailTemplate = z.infer<typeof EmailTemplateSchema>;

// Create EmailTemplate schema (excludes id, timestamps)
export const CreateEmailTemplateSchema = EmailTemplateSchema.omit({
  id: true,
}).strict();

export type CreateEmailTemplate = z.infer<typeof CreateEmailTemplateSchema>;

// Update EmailTemplate schema (all fields optional except id)
export const UpdateEmailTemplateSchema = EmailTemplateSchema.omit({
}).partial().extend({
  id: z.string().optional(),
}).strict();

export type UpdateEmailTemplate = z.infer<typeof UpdateEmailTemplateSchema>;

// Query parameters schema with preprocessing
export const EmailTemplateQueryParams = z.object({
  limit: z.preprocess(
    (val) => (typeof val === "string" ? parseInt(val, 10) : val),
    z.number().min(1).max(100).default(20)
  ),
  offset: z.preprocess(
    (val) => (typeof val === "string" ? parseInt(val, 10) : val),
    z.number().min(0).default(0)
  ),
  order: z.string().optional(),
  fields: z.preprocess(
    (val) => (typeof val === "string" ? val.split(",") : val),
    z.array(z.string()).optional()
  ),
  q: z.string().optional(),
  // Add specific filter fields based on model
  template_key: z.string().optional(),
  is_active: z.preprocess(
    (val) => {
      if (typeof val === "string") {
        return val.toLowerCase() === "true";
      }
      return val;
    },
    z.boolean().optional()
  ),
  template_type: z.string().optional(),
});

export type EmailTemplateQueryParams = z.infer<typeof EmailTemplateQueryParams>;

// Schema for bulk operations
export const BulkEmailTemplateSchema = z.object({
  ids: z.array(z.string().min(1)).min(1, "At least one ID is required"),
});

export type BulkEmailTemplate = z.infer<typeof BulkEmailTemplateSchema>;



