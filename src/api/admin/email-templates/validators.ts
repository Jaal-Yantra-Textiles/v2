import { z } from "zod";

// Schema for creating email templates
export const EmailTemplateSchema = z.object({
  name: z.string().min(1, "Name is required"),
  description: z.string().nullable().optional(),
  to: z.string().nullable().optional(),
  from: z.string().email("From must be a valid email address").optional(),
  template_key: z.string().min(1, "Template key is required"),
  subject: z.string().min(1, "Subject is required"),
  html_content: z.string().min(1, "HTML content is required"),
  variables: z.record(z.unknown()).nullable().optional(),
  template_type: z.string().min(1, "Template type is required"),
  is_active: z.boolean().optional().default(true),
});

export type EmailTemplate = z.infer<typeof EmailTemplateSchema>;

// Schema for updating email templates
export const UpdateEmailTemplateSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  to: z.string().nullable().optional(),
  from: z.string().email("From must be a valid email address").optional(),
  template_key: z.string().min(1).optional(),
  subject: z.string().min(1).optional(),
  html_content: z.string().min(1).optional(),
  variables: z.record(z.unknown()).nullable().optional(),
  template_type: z.string().min(1).optional(),
  is_active: z.boolean().optional(),
});

export type UpdateEmailTemplate = z.infer<typeof UpdateEmailTemplateSchema>;

// Query schema for listing email templates
export const listEmailTemplatesQuerySchema = z.object({
  q: z.string().optional(),
  template_type: z.string().optional(),
  is_active: z.preprocess(
    (val) => {
      if (val === "true") return true;
      if (val === "false") return false;
      return undefined;
    },
    z.boolean().optional()
  ),
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

export type ListEmailTemplatesQuery = z.infer<typeof listEmailTemplatesQuerySchema>;
