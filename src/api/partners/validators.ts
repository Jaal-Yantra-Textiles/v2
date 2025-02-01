import { z } from "zod"

export const partnerSchema = z.object({
    name: z.string(),
    handle: z.string().optional(),
    logo: z.string().optional(),
    status: z.enum(['active', 'inactive', 'pending']).optional(),
    is_verified: z.boolean().optional(),
    admin: z.object({
        email: z.string(),
        first_name: z.string().optional(),
        last_name: z.string().optional(),
        phone: z.string().optional(),
        role: z.enum(['owner', 'admin', 'manager']).optional()
    }).strict(),
}).strict()
