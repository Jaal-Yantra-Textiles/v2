import { z } from "zod";

// Validator for agreement access with token
export const WebAgreementAccessSchema = z.object({
  token: z.string().min(1, "Access token is required"),
});

// Validator for agreement response submission
export const WebAgreementResponseSchema = z.object({
  token: z.string().min(1, "Access token is required"),
  agreed: z.boolean({
    required_error: "Agreement decision is required",
    invalid_type_error: "Agreement decision must be true or false"
  }),
  response_notes: z.string().max(1000, "Response notes cannot exceed 1000 characters").optional(),
  response_ip: z.string().ip("Invalid IP address").optional(),
  response_user_agent: z.string().max(500, "User agent cannot exceed 500 characters").optional(),
});

export type WebAgreementAccess = z.infer<typeof WebAgreementAccessSchema>;
export type WebAgreementResponse = z.infer<typeof WebAgreementResponseSchema>;
