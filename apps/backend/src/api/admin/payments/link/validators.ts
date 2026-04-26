import { z } from "@medusajs/framework/zod"

const StatusEnum = z.enum(["Pending", "Processing", "Completed", "Failed", "Cancelled"]) 
const PaymentTypeEnum = z.enum(["Bank", "Cash", "Digital_Wallet"]) 

export const CreatePaymentAndLinkSchema = z.object({
  payment: z.object({
    amount: z.number().gt(0),
    status: StatusEnum.optional(),
    payment_type: PaymentTypeEnum,
    payment_date: z.coerce.date(),
    metadata: z.record(z.any()).nullish(),
    paid_to_id: z.string().optional(),
  }),
  personIds: z.array(z.string()).optional(),
  partnerIds: z.array(z.string()).optional(),
  inventoryOrderIds: z.array(z.string()).optional(),
})

export type CreatePaymentAndLink = z.infer<typeof CreatePaymentAndLinkSchema>

export const CreatePaymentAndLink = CreatePaymentAndLinkSchema
