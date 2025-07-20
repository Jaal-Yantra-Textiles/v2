import { z } from "zod";

export const sendToPartnerSchema = z.object({
  partnerId: z.string().min(1, "Partner ID is required"),
  notes: z.string().optional()
});

export type SendInventoryOrderToPartnerInput = z.infer<typeof sendToPartnerSchema>;