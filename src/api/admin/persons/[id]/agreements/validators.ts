import { z } from "zod";

export type AdminSendPersonAgreementReq = z.infer<
  typeof AdminSendPersonAgreementReq
>;
export const AdminSendPersonAgreementReq = z
  .object({
    agreement_id: z.string().min(1, "Agreement ID is required"),
    person_ids: z.array(z.string()).optional(), // Optional array of additional person IDs for multi-signer
    template_key: z.string().optional(),
  })
  .strict();
