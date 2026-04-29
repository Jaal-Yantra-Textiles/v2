import { z } from "@medusajs/framework/zod"

export const PostPartnerSchema = z.object({
  partner: z.object({
    name: z.string().min(1),
    handle: z.string().optional(),
    logo: z.string().url().optional(),
    status: z.enum(["active", "inactive", "pending"]).optional().default("pending"),
    is_verified: z.boolean().optional().default(false),
    workspace_type: z.enum(["seller", "manufacturer", "individual"]).optional().default("manufacturer"),
  }),
  admin: z.object({
    email: z.string().email(),
    first_name: z.string().min(1),
    last_name: z.string().min(1),
    phone: z.string().optional(),
    role: z.enum(["owner", "admin", "manager"]).optional().default("owner"),
  }),
  auth_identity_id: z.string().optional(),
})

export const listPartnersQuerySchema = z.object({
  // Medusa's prepareListQuery expects `fields` to be a string and calls `.split(",")`.
  // Normalize both string and array inputs to a single comma-separated string.
  fields: z.preprocess((val) => {
    if (Array.isArray(val)) {
      const cleaned = val
        .flatMap((v) => (typeof v === "string" ? v.split(",") : []))
        .map((s) => s.trim())
        .filter(Boolean)
      return Array.from(new Set(cleaned)).join(",") || undefined
    }
    if (typeof val === "string") {
      const cleaned = val
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
      return cleaned.length ? cleaned.join(",") : undefined
    }
    return undefined
  }, z.string().optional()),
  // Pagination + filters used by the admin UI's partner list (page.tsx →
  // usePartners). Without these the validator rejects the request with
  // "Unrecognized fields: 'limit, offset'" and the table renders empty.
  // Mirrors the schema for /admin/persons/partner so both list endpoints
  // accept the same params.
  offset: z.coerce.number().int().min(0).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  q: z.string().optional(),
  name: z.string().optional(),
  handle: z.string().optional(),
  status: z.enum(["active", "inactive", "pending"]).optional(),
  is_verified: z.enum(["true", "false"]).optional(),
})

export type PostPartnerWithAdminSchema = z.infer<typeof PostPartnerSchema>
export type ListPartnersQuerySchema = z.infer<typeof listPartnersQuerySchema>
