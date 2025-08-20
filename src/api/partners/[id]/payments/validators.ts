import { z } from "zod"

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
    required_error: "Value for InternalPaymentDetails.type is required, 'undefined' found",
    invalid_type_error:
      "Invalid value for InternalPaymentDetails.type. Expected one of: bank_account, cash_account, digital_wallet",
  }),
  account_name: z.string().min(1),
  account_number: z.string().optional(),
  bank_name: z.string().optional(),
  ifsc_code: z.string().optional(),
  wallet_id: z.string().optional(),
  metadata: z.record(z.any()).nullish(),
})
export type CreatePaymentMethodForPartner = z.infer<typeof CreatePaymentMethodForPartnerSchema>
export const CreatePaymentMethodForPartner = CreatePaymentMethodForPartnerSchema
