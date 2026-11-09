import { z } from "@medusajs/framework/zod"

export const issueOrderTaxInvoiceSchema = z.object({
  /** Return the invoice as it would print, without spending a number. */
  preview: z.boolean().optional(),
  /** Cancel the current invoice of a changed order and issue a new one. */
  reissue: z.boolean().optional(),
  /** The buyer's GSTIN, for a business purchase. Printed on the invoice. */
  buyer_gstin: z
    .string()
    .trim()
    .regex(/^[0-9]{2}[A-Z0-9]{13}$/i, "A GSTIN is 15 characters, starting with the 2-digit state code")
    .optional(),
})

export type IssueOrderTaxInvoiceBody = z.infer<typeof issueOrderTaxInvoiceSchema>
