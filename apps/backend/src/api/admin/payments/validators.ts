import { z } from "@medusajs/framework/zod";

const StatusEnum = z.enum(["Pending", "Processing", "Completed", "Failed", "Cancelled"]);
const PaymentTypeEnum = z.enum(["Bank", "Cash", "Digital_Wallet"]);

// Create Payment payload
export const PaymentSchema = z.object({
  amount: z.number().gt(0),
  status: StatusEnum.optional(),
  payment_type: PaymentTypeEnum,
  payment_date: z.coerce.date(),
  metadata: z.record(z.string(), z.any()).nullish(),
  paid_to_id: z.string().optional(),
});

export type Payment = z.infer<typeof PaymentSchema>;

// Update Payment payload (kept minimal; extend as needed)
export const UpdatePaymentSchema = z.object({
  amount: z.number().gt(0).optional(),
  status: StatusEnum.optional(),
  payment_type: PaymentTypeEnum.optional(),
  payment_date: z.coerce.date().optional(),
  metadata: z.record(z.string(), z.any()).nullish(),
  paid_to_id: z.string().optional(),
});

export type UpdatePayment = z.infer<typeof UpdatePaymentSchema>;

// List query schema
export const ListPaymentsQuerySchema = z.object({
  offset: z.coerce.number().int().min(0).default(0).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50).optional(),
});

export type ListPaymentsQuery = z.infer<typeof ListPaymentsQuerySchema>;

export const ListPaymentsQuery = ListPaymentsQuerySchema;

/**
 * Which payout an existing payment settles (#1710).
 *
 * ⚠️ Its middleware entry MUST precede `/admin/payments/:id`. Matching is
 * prefix-based and `UpdatePaymentSchema` is `.strict()`, so the update entry
 * would otherwise claim this path and reject `payment_submission_id` as an
 * unrecognised field — a 400 that looks like a bad request rather than a
 * mis-ordered route.
 */
export const PaymentSettlesSchema = z.object({
  payment_submission_id: z.string().min(1),
})

export type PaymentSettles = z.infer<typeof PaymentSettlesSchema>
