import { z } from "zod";

export type AdminSendPersonAgreementReq = z.infer<
  typeof AdminSendPersonAgreementReq
>;
export const AdminSendPersonAgreementReq = z
  .object({
    agreement_id: z.string().min(1, "Agreement ID is required"),
    template_key: z.string().optional(),
  })
  .strict();
