import { z } from "@medusajs/framework/zod"

export const partnerSchema = z.object({
    name: z.string(),
    handle: z.string().optional(),
    logo: z.string().optional(),
    status: z.enum(['active', 'inactive', 'pending']).optional(),
    is_verified: z.boolean().optional(),
    whatsapp_number: z.string().optional(),
    admin: z.object({
        email: z.string(),
        first_name: z.string().optional(),
        last_name: z.string().optional(),
        phone: z.string().optional(),
        role: z.enum(['owner', 'admin', 'manager']).optional()
    }).strict(),
}).strict()

export const partnerUpdateSchema = z.object({
    name: z.string().optional(),
    handle: z.string().optional(),
    logo: z.string().nullable().optional(),
    status: z.enum(['active', 'inactive', 'pending']).optional(),
    is_verified: z.boolean().optional(),
    whatsapp_number: z.string().nullable().optional(),
    metadata: z.record(z.any()).nullable().optional(),
})
