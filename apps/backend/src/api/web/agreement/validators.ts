import { z } from "@medusajs/framework/zod";

// Validator for agreement access with token
export const WebAgreementAccessSchema = z.object({
  token: z.string().min(1, "Access token is required"),
});

// Validator for agreement response submission
export const WebAgreementResponseSchema = z.object({
  token: z.string().min(1, "Access token is required"),
  agreed: z.boolean({
    error: (issue) =>
      issue.input === undefined
        ? "Agreement decision is required"
        : "Agreement decision must be true or false",
  }),
  response_notes: z.string().max(1000, "Response notes cannot exceed 1000 characters").optional(),
  response_ip: z.union([z.ipv4(), z.ipv6()], { error: "Invalid IP address" }).optional(),
  response_user_agent: z.string().max(500, "User agent cannot exceed 500 characters").optional(),
});

export type WebAgreementAccess = z.infer<typeof WebAgreementAccessSchema>;
export type WebAgreementResponse = z.infer<typeof WebAgreementResponseSchema>;
