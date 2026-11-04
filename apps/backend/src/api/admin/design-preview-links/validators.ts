import { z } from "zod"

export const AdminCreateDesignPreviewLinkSchema = z
  .object({
    // A bundle: every design on this (collated) design work order.
    order_id: z.string().min(1).optional(),
    // One design.
    design_id: z.string().min(1).optional(),
    // Days until the link stops working. Omit for a link that lasts until revoked.
    expires_in_days: z.number().int().positive().max(365).optional(),
    // Who it is for — recorded, not enforced (the token is the capability).
    partner_id: z.string().min(1).optional(),
    // Page heading. Defaults to "Bundle #<n>" for an order.
    label: z.string().min(1).max(200).optional(),
    metadata: z.record(z.string(), z.any()).optional(),
  })
  .refine((v) => !!v.order_id !== !!v.design_id, {
    message: "Pass exactly one of order_id or design_id",
  })

export type AdminCreateDesignPreviewLinkReq = z.infer<typeof AdminCreateDesignPreviewLinkSchema>
