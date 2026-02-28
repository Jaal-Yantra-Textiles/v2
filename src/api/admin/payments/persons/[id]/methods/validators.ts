import { z } from "@medusajs/framework/zod"

export const ListPaymentMethodsByPersonQuerySchema = z.object({
  offset: z.coerce.number().int().min(0).default(0).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50).optional(),
})
export type ListPaymentMethodsByPersonQuery = z.infer<typeof ListPaymentMethodsByPersonQuerySchema>
export const ListPaymentMethodsByPersonQuery = ListPaymentMethodsByPersonQuerySchema

export const CreatePaymentMethodForPersonSchema = z.object({
  type: z.enum(["bank_account", "cash_account", "digital_wallet"], {
    required_error:
      "Value for InternalPaymentDetails.type is required, 'undefined' found",
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
export type CreatePaymentMethodForPerson = z.infer<typeof CreatePaymentMethodForPersonSchema>
