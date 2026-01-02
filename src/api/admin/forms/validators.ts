import { z } from "zod"

export const AdminCreateFormFieldSchema = z.object({
  name: z.string().min(1),
  label: z.string().min(1),
  type: z
    .enum([
      "text",
      "email",
      "textarea",
      "number",
      "select",
      "checkbox",
      "radio",
      "date",
      "phone",
      "url",
    ])
    .default("text"),
  required: z.boolean().default(false),
  placeholder: z.string().nullable().optional(),
  help_text: z.string().nullable().optional(),
  options: z.record(z.any()).nullable().optional(),
  validation: z.record(z.any()).nullable().optional(),
  order: z.number().optional(),
  metadata: z.record(z.any()).nullable().optional(),
})

export const AdminCreateFormSchema = z
  .object({
    website_id: z.string().nullable().optional(),
    domain: z.string().nullable().optional(),
    handle: z.string().min(1),
    title: z.string().min(1),
    description: z.string().nullable().optional(),
    status: z.enum(["draft", "published", "archived"]).default("draft"),
    submit_label: z.string().nullable().optional(),
    success_message: z.string().nullable().optional(),
    settings: z.record(z.any()).nullable().optional(),
    metadata: z.record(z.any()).nullable().optional(),
    fields: z.array(AdminCreateFormFieldSchema).optional(),
  })
  .refine(
    (v) => Boolean(v.website_id) || Boolean(v.domain),
    "Either website_id or domain must be provided"
  )

export const AdminUpdateFormSchema = z
  .object({
    website_id: z.string().nullable().optional(),
    domain: z.string().nullable().optional(),
    handle: z.string().min(1).optional(),
    title: z.string().min(1).optional(),
    description: z.string().nullable().optional(),
    status: z.enum(["draft", "published", "archived"]).optional(),
    submit_label: z.string().nullable().optional(),
    success_message: z.string().nullable().optional(),
    settings: z.record(z.any()).nullable().optional(),
    metadata: z.record(z.any()).nullable().optional(),
  })
  .refine(
    (v) => v.website_id !== undefined || v.domain !== undefined || Object.keys(v).length > 0,
    "At least one field must be provided"
  )

export const AdminSetFormFieldsSchema = z.object({
  fields: z.array(AdminCreateFormFieldSchema).default([]),
})

export const AdminListFormsQuerySchema = z.object({
  q: z.string().optional(),
  status: z.enum(["draft", "published", "archived"]).optional(),
  website_id: z.string().optional(),
  domain: z.string().optional(),
  limit: z.coerce.number().min(1).max(100).default(20),
  offset: z.coerce.number().min(0).default(0),
})

export const AdminListFormResponsesQuerySchema = z.object({
  q: z.string().optional(),
  status: z.enum(["new", "read", "archived"]).optional(),
  email: z.string().optional(),
  limit: z.coerce.number().min(1).max(100).default(20),
  offset: z.coerce.number().min(0).default(0),
})

export type AdminCreateForm = z.infer<typeof AdminCreateFormSchema>
export type AdminUpdateForm = z.infer<typeof AdminUpdateFormSchema>
export type AdminSetFormFields = z.infer<typeof AdminSetFormFieldsSchema>
export type AdminListFormsQuery = z.infer<typeof AdminListFormsQuerySchema>
export type AdminListFormResponsesQuery = z.infer<typeof AdminListFormResponsesQuerySchema>
