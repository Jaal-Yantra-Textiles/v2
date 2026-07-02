import { z } from "@medusajs/framework/zod"

export const partnerSchema = z.object({
    name: z.string(),
    handle: z.string().optional(),
    logo: z.string().optional(),
    status: z.enum(['active', 'inactive', 'pending']).optional(),
    is_verified: z.boolean().optional(),
    workspace_type: z.enum(['seller', 'manufacturer', 'individual']).optional(),
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
    workspace_type: z.enum(['seller', 'manufacturer', 'individual']).optional(),
    whatsapp_number: z.string().nullable().optional(),
    // Billing locale (drives subscription provider routing). Currency is
    // normalized to lower-case so the "inr" comparison in the subscription route
    // is stable regardless of what the client sends.
    country_code: z.string().min(2).max(2).nullable().optional(),
    currency_code: z
        .string()
        .min(3)
        .max(3)
        .transform((c) => c.toLowerCase())
        .nullable()
        .optional(),
    metadata: z.record(z.string(), z.any()).nullable().optional(),
})
