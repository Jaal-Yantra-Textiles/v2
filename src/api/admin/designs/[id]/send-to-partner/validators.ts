import { z } from "zod"

export const sendDesignToPartnerSchema = z.object({
  partnerId: z.string().min(1, "Partner ID is required"),
  notes: z.string().optional(),
})

export type SendDesignToPartnerInput = z.infer<typeof sendDesignToPartnerSchema>
