import { z } from "@medusajs/framework/zod"

// List payments for a partner
export const ListPaymentsByPartnerQuerySchema = z.object({
  offset: z.coerce.number().int().min(0).default(0).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50).optional(),
})
export type ListPaymentsByPartnerQuery = z.infer<typeof ListPaymentsByPartnerQuerySchema>
export const ListPaymentsByPartnerQuery = ListPaymentsByPartnerQuerySchema

// List payment methods for a partner
export const ListPaymentMethodsByPartnerQuerySchema = z.object({
  offset: z.coerce.number().int().min(0).default(0).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50).optional(),
})
export type ListPaymentMethodsByPartnerQuery = z.infer<typeof ListPaymentMethodsByPartnerQuerySchema>
export const ListPaymentMethodsByPartnerQuery = ListPaymentMethodsByPartnerQuerySchema

// Create a payment method for a partner
export const CreatePaymentMethodForPartnerSchema = z.object({
  type: z.enum(["bank_account", "cash_account", "digital_wallet"], {
    error: (issue) =>
      issue.input === undefined
        ? "Value for InternalPaymentDetails.type is required, 'undefined' found"
        : "Invalid value for InternalPaymentDetails.type. Expected one of: bank_account, cash_account, digital_wallet",
  }),
  account_name: z.string().min(1),
  account_number: z.string().optional(),
  bank_name: z.string().optional(),
  ifsc_code: z.string().optional(),
  wallet_id: z.string().optional(),
  metadata: z.record(z.string(), z.any()).nullish(),
  /**
   * Marks this the method a payout falls back to when the reviewer names none.
   * Exclusive per owner — setting it unsets the owner's other methods.
   */
  is_default: z.boolean().optional(),
})
export type CreatePaymentMethodForPartner = z.infer<typeof CreatePaymentMethodForPartnerSchema>
export const CreatePaymentMethodForPartner = CreatePaymentMethodForPartnerSchema

// Update a payment method for a partner (all fields optional — PATCH semantics)
export const UpdatePaymentMethodForPartnerSchema = z.object({
  type: z.enum(["bank_account", "cash_account", "digital_wallet"]).optional(),
  account_name: z.string().min(1).optional(),
  account_number: z.string().nullish(),
  bank_name: z.string().nullish(),
  ifsc_code: z.string().nullish(),
  wallet_id: z.string().nullish(),
  metadata: z.record(z.string(), z.any()).nullish(),
  /**
   * Marks this the method a payout falls back to when the reviewer names none.
   * Exclusive per owner — setting it unsets the owner's other methods.
   */
  is_default: z.boolean().optional(),
})
export type UpdatePaymentMethodForPartner = z.infer<typeof UpdatePaymentMethodForPartnerSchema>
export const UpdatePaymentMethodForPartner = UpdatePaymentMethodForPartnerSchema
