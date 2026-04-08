import { z } from "zod"

export const CreatePaymentSubmissionSchema = z.object({
  design_ids: z
    .array(z.string().min(1))
    .min(1, "At least one design is required"),
  notes: z.string().optional(),
  documents: z
    .array(
      z.object({
        id: z.string().optional(),
        url: z.string(),
        filename: z.string().optional(),
        mimeType: z.string().optional(),
      })
    )
    .optional(),
  metadata: z.record(z.any()).optional(),
})

export const ListPaymentSubmissionsQuerySchema = z.object({
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
  limit: z.coerce.number().int().min(1).max(100).default(20).optional(),
  offset: z.coerce.number().int().min(0).default(0).optional(),
})
