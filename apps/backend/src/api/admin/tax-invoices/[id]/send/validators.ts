import { z } from "@medusajs/framework/zod"

export const sendTaxInvoiceSchema = z.object({
  /** Return who it would go to and what it says, without sending. */
  preview: z.boolean().optional(),
  /** Must be true to send: an email cannot be recalled. */
  confirm: z.boolean().optional(),
})

export type SendTaxInvoiceBody = z.infer<typeof sendTaxInvoiceSchema>
