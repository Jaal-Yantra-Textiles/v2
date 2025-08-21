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


export type PostPartnerWithAdminSchema = z.infer<typeof PostPartnerSchema>