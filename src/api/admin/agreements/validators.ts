import { z } from "zod";

// Create Agreement Schema
export const CreateAgreementSchema = z.object({
  title: z.string().min(1, "Title is required"),
  status: z.enum(["draft", "active", "expired", "cancelled"]).default("draft"),
  subject: z.string().optional(),
  template_key: z.string().optional(),
  valid_from: z.string().transform((val) => val ? new Date(val) : undefined).optional(),
  valid_until: z.string().transform((val) => val ? new Date(val) : undefined).optional(),
  from_email: z.string().email().optional(),
  content: z.string().optional(),
  metadata: z.record(z.any()).default({}),
});

// Update Agreement Schema
export const UpdateAgreementSchema = z.object({
  title: z.string().min(1).optional(),
  status: z.enum(["draft", "active", "expired", "cancelled"]).optional(),
  subject: z.string().optional(),
  template_key: z.string().optional(),
  valid_from: z.string().transform((val) => val ? new Date(val) : undefined).optional(),
  valid_until: z.string().transform((val) => val ? new Date(val) : undefined).optional(),
  from_email: z.string().email().optional(),
  content: z.string().optional(),
  metadata: z.record(z.any()).optional(),
});

// Query Parameters Schema
export const AgreementQueryParams = z.object({
  q: z.string().optional(),
  search: z.string().optional(),
  status: z.enum(["draft", "active", "expired", "cancelled"]).optional(),
  limit: z.coerce.number().min(1).max(100).default(20),
  offset: z.coerce.number().min(0).default(0),
  order: z.string().optional(),
});

// Type exports
export type CreateAgreement = z.infer<typeof CreateAgreementSchema>;
export type UpdateAgreement = z.infer<typeof UpdateAgreementSchema>;
export type AgreementQueryParamsType = z.infer<typeof AgreementQueryParams>;

// Legacy export for compatibility
export const AgreementSchema = CreateAgreementSchema;
export type Agreement = CreateAgreement;
