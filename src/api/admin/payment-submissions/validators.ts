import { z } from "zod"

export const AdminListPaymentSubmissionsQuerySchema = z.object({
  status: z
    .enum([
      "Draft",
      "Pending",
      "Under_Review",
      "Approved",
      "Rejected",
      "Paid",
    ])
    .optional(),
  partner_id: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20).optional(),
  offset: z.coerce.number().int().min(0).default(0).optional(),
})

export const AdminReviewPaymentSubmissionSchema = z.object({
  action: z.enum(["approve", "reject"]),
  rejection_reason: z.string().optional(),
  amount_override: z.number().optional(),
  payment_type: z
    .enum(["Bank", "Cash", "Digital_Wallet"])
    .optional()
    .default("Bank"),
  paid_to_id: z.string().optional(),
  notes: z.string().optional(),
})
