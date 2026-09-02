import { z } from "@medusajs/framework/zod"

const StatusEnum = z.enum(["Pending", "Processing", "Completed", "Failed", "Cancelled"])
const PaymentTypeEnum = z.enum(["Bank", "Cash", "Digital_Wallet"])

// #496 — file attachments (receipts/invoices) persisted to the link table.
export const PaymentAttachmentSchema = z.object({
  file_id: z.string().min(1),
  url: z.string().min(1),
  filename: z.string().optional().nullable(),
  mime_type: z.string().optional().nullable(),
  size: z.number().nonnegative().optional().nullable(),
  metadata: z.record(z.string(), z.any()).nullish(),
})

export const CreatePaymentAndLinkSchema = z.object({
  payment: z.object({
    amount: z.number().gt(0),
    status: StatusEnum.optional(),
    payment_type: PaymentTypeEnum,
    payment_date: z.coerce.date(),
    metadata: z.record(z.string(), z.any()).nullish(),
    paid_to_id: z.string().optional(),
  }),
  personIds: z.array(z.string()).optional(),
  partnerIds: z.array(z.string()).optional(),
  inventoryOrderIds: z.array(z.string()).optional(),
  /**
   * The payout(s) this payment settles (#1710).
   *
   * 🔑 The fact a human states. Everything else on this request says who the
   * money is ABOUT — a person, a partner, an order — and none of it says what
   * it pays OFF, which is why the partner ledger could read `recorded: 0`
   * beside `outstanding: 28,200` on an order that had already seen INR 20,000.
   *
   * Naming a submission here attaches the payment to that payout on the ledger
   * and takes it out of "recorded separately". Leaving it absent is still
   * correct for an advance or an unrelated payment — the ledger will show the
   * money against the order and warn, rather than assume.
   */
  paymentSubmissionIds: z.array(z.string()).optional(),
  attachments: z.array(PaymentAttachmentSchema).optional(),
})

export type CreatePaymentAndLink = z.infer<typeof CreatePaymentAndLinkSchema>

export const CreatePaymentAndLink = CreatePaymentAndLinkSchema
