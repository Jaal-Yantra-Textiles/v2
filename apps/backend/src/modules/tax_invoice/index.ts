import { Module } from "@medusajs/framework/utils"
import TaxInvoiceService from "./service"

export const TAX_INVOICE_MODULE = "tax_invoice"

const TaxInvoiceModule = Module(TAX_INVOICE_MODULE, {
  service: TaxInvoiceService,
})

export default TaxInvoiceModule
