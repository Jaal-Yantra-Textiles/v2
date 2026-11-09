import { model } from "@medusajs/framework/utils"

/**
 * A GST tax invoice issued for an order (#2532).
 *
 * 🔑 FROZEN once issued. `document` holds the whole printable invoice as it was
 * the moment the number was assigned, and the PDF is always drawn from it, never
 * from the live order. An order edited afterwards does not rewrite a bill the
 * customer already holds: it gets a NEW invoice, and the old one is marked
 * `cancelled` (never deleted — GST numbers may not be reused or vanish).
 *
 * Numbering is one series per Indian financial year (`JYT/2026-27/0001`); the
 * unique index on (financial_year, sequence) is what makes two simultaneous
 * issues collide instead of sharing a number.
 */
const TaxInvoice = model
  .define("tax_invoice", {
    id: model.id({ prefix: "tinv" }).primaryKey(),
    order_id: model.text(),
    invoice_number: model.text(),
    /** Indian FY the number belongs to, e.g. "2026-27". */
    financial_year: model.text(),
    sequence: model.number(),
    status: model.enum(["issued", "cancelled"]).default("issued"),
    issued_at: model.dateTime(),
    currency_code: model.text(),
    /** Grand total as printed, for lists — the document is the source of truth. */
    grand_total: model.bigNumber(),
    /** The frozen `OrderTaxInvoiceModel`. */
    document: model.json(),
    cancelled_at: model.dateTime().nullable(),
    cancel_reason: model.text().nullable(),
  })
  .indexes([
    { on: ["order_id"] },
    { on: ["invoice_number"], unique: true },
    { on: ["financial_year", "sequence"], unique: true },
  ])

export default TaxInvoice
