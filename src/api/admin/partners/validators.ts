import { z } from "zod"

export const PostPartnerSchema = z.object({
  partner: z.object({
    name: z.string().min(1),
    handle: z.string().optional(),
    logo: z.string().url().optional(),
    status: z.enum(["active", "inactive", "pending"]).optional().default("pending"),
    is_verified: z.boolean().optional().default(false),
  }),
  admin: z.object({
    email: z.string().email(),
    first_name: z.string().optional(),
    last_name: z.string().optional(),
    phone: z.string().optional(),
    role: z.enum(["owner", "admin", "manager"]).optional().default("owner"),
  }),
  auth_identity_id: z.string().optional(),
})

export const listPartnersQuerySchema = z.object({
  fields: z
    .preprocess((val) => {
      if (typeof val === "string") {
        return val.split(",");
      }
      if (Array.isArray(val)) {
        // Flatten any accidental comma-joined items inside the array
        return val.flatMap((v) => (typeof v === "string" ? v.split(",") : []));
      }
      return val;
    }, z.array(z.string()).optional())
    .transform((arr) => {
      if (!arr) return arr;
      const cleaned = arr
        .map((s) => (typeof s === "string" ? s.trim() : ""))
        .filter((s) => !!s);
      return Array.from(new Set(cleaned));
    }),
})

export type PostPartnerWithAdminSchema = z.infer<typeof PostPartnerSchema>
export type ListPartnersQuerySchema = z.infer<typeof listPartnersQuerySchema>
