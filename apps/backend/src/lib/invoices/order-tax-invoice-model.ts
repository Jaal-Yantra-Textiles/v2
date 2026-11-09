import { amountInWords } from "./amount-in-words"
import { gstinStateCode, stateCodeOf, stateName } from "./gst-state"

/**
 * The PRINTABLE shape of a GST tax invoice for an order (#2532) — what the bill
 * says, apart from how it is drawn. Same split as the inventory-order proforma:
 * the arithmetic is here, pure and tested; the renderer only positions text.
 *
 * 🔑 Tax is never re-derived. Each line's taxable value and tax are Medusa's own
 * `total - tax_total` and `tax_total` (whether the price was tax-inclusive or
 * not), rounded to paise. A second tax calculation in a document generator is
 * how a printed bill comes to disagree with what the customer was charged.
 *
 * Supply type decides only how that tax is LABELLED:
 * - same state as the seller → half CGST, half SGST
 * - another Indian state → IGST
 * - outside India → export (IGST column, usually 0, with the LUT note)
 */

export type TaxInvoiceParty = {
  name: string
  lines: string[]
  state?: string | null
  postal_code?: string | null
  country_code?: string | null
}

export type TaxInvoiceLineInput = {
  title: string
  variant_title?: string | null
  sku?: string | null
  hs_code?: string | null
  quantity: number
  /** Medusa's line `total` (after discount, including tax). */
  total: number
  /** Medusa's line `tax_total`. */
  tax_total: number
  /** Sum of the line's tax-line rates, in percent. */
  tax_rate: number
}

export type TaxInvoiceChargeInput = {
  name: string
  total: number
  tax_total: number
  tax_rate: number
}

export type OrderTaxInvoiceInput = {
  /** null while previewing: a preview never consumes a number. */
  invoice_number: string | null
  invoice_date: string
  order: {
    id: string
    display_id: number | string | null
    created_at: string | null
    currency_code: string
    /** Medusa's order `total` — what the customer was charged. */
    total: number
    paid_total: number
  }
  seller: { legal_name: string; gstin: string | null; address: TaxInvoiceParty }
  bill_to: TaxInvoiceParty | null
  ship_to: TaxInvoiceParty | null
  /** Where the goods leave from: the stock location on the order's channel. */
  dispatch_from?: TaxInvoiceParty | null
  buyer_gstin?: string | null
  lines: TaxInvoiceLineInput[]
  charges: TaxInvoiceChargeInput[]
  export_lut_arn?: string | null
}

export type SupplyType = "intra_state" | "inter_state" | "export"

export type TaxInvoiceRow = {
  sl: number
  /** A product line, or a charge such as shipping (a service: no HSN). */
  kind: "goods" | "charge"
  description: string
  hsn: string
  quantity: number
  /** Taxable value per unit. */
  unit_rate: number
  taxable: number
  tax_rate: number
  cgst: number
  sgst: number
  igst: number
  total: number
}

export type OrderTaxInvoiceModel = {
  title: string
  invoice_number: string | null
  invoice_date: string
  order_id: string
  order_ref: string
  order_date: string | null
  currency_code: string
  seller: { legal_name: string; gstin: string | null; lines: string[] }
  bill_to: { name: string; lines: string[] }
  ship_to: { name: string; lines: string[] } | null
  buyer_gstin: string | null
  supply_type: SupplyType
  place_of_supply: string
  rows: TaxInvoiceRow[]
  totals: {
    taxable: number
    cgst: number
    sgst: number
    igst: number
    tax: number
    round_off: number
    grand_total: number
    paid: number
    balance_due: number
  }
  amount_in_words: string
  notes: string[]
}

/** The most a printed total may drift from Medusa's before we refuse. */
export const MAX_ROUND_OFF = 1

const num = (value: unknown): number => {
  const parsed = Number(value ?? 0)
  return Number.isFinite(parsed) ? parsed : 0
}

const round2 = (value: number): number => Math.round(value * 100) / 100

/**
 * PURE: how this supply is taxed, and where it is supplied to.
 *
 * 🔑 The seller's state is the state of the GSTIN the invoice is issued under
 * (its first two digits), NOT where the stock sits: our registration is Delhi
 * (07) while goods leave Dharamshala (02). Intra-state only when the place of
 * supply is that same state.
 *
 * Place of supply: the buyer's ship-to state, then bill-to. With no buyer
 * address at all (in-person pickup, most design orders) it is where the goods
 * were handed over — the order's dispatch location — and only failing that the
 * seller's own state. A buyer address whose state cannot be read is refused:
 * guessing a state on a tax invoice is worse than stopping.
 */
export function resolveSupplyType(
  seller: { gstin?: string | null; address: TaxInvoiceParty },
  ship_to: TaxInvoiceParty | null,
  bill_to: TaxInvoiceParty | null,
  dispatch_from: TaxInvoiceParty | null = null
): { supply_type: SupplyType; place_of_supply: string } {
  const country = String(
    ship_to?.country_code || bill_to?.country_code || ""
  ).toLowerCase()
  if (country && country !== "in") {
    return {
      supply_type: "export",
      place_of_supply: `Outside India (${country.toUpperCase()})`,
    }
  }

  const sellerCode = gstinStateCode(seller.gstin) ?? stateCodeOf(seller.address.state)
  const label = (code: string, suffix = "") =>
    `${stateName(code)} (${code})${suffix}`
  const decide = (code: string, suffix = "") => ({
    supply_type: (code === sellerCode ? "intra_state" : "inter_state") as SupplyType,
    place_of_supply: label(code, suffix),
  })

  const buyer = [ship_to, bill_to].find(
    (p) => p && (p.state || p.postal_code || p.lines.some((l) => l && l !== "IN"))
  )
  if (buyer) {
    const code = stateCodeOf(buyer.state)
    if (!code) {
      throw new Error(
        `Cannot read the buyer's state from "${buyer.state ?? ""}". Add the state to the order's address before issuing a tax invoice.`
      )
    }
    return decide(code)
  }

  const dispatchCode = stateCodeOf(dispatch_from?.state)
  if (dispatchCode) return decide(dispatchCode, " - handed over at dispatch")
  if (sellerCode) return decide(sellerCode, " - no delivery address")
  throw new Error("Cannot determine the place of supply: no buyer address and no seller state.")
}

const describe = (line: TaxInvoiceLineInput): string => {
  const variant = String(line.variant_title ?? "").trim()
  const parts = [line.title]
  if (variant && variant.toLowerCase() !== "default" && variant !== line.title) {
    parts.push(variant)
  }
  return parts.join(" - ")
}

const splitTax = (
  tax: number,
  rate: number,
  supply: SupplyType
): { cgst: number; sgst: number; igst: number } => {
  if (supply !== "intra_state") return { cgst: 0, sgst: 0, igst: tax }
  // Halve once and give SGST the remainder, so the two always sum to the tax
  // even when it is an odd number of paise.
  const cgst = round2(tax / 2)
  return { cgst, sgst: round2(tax - cgst), igst: 0 }
}

/**
 * PURE: the invoice an order prints as. Throws when the lines cannot be made
 * to agree with the order total within `MAX_ROUND_OFF` — an invoice that does
 * not add up to what was charged must not be issued.
 */
export function buildOrderTaxInvoiceModel(
  input: OrderTaxInvoiceInput
): OrderTaxInvoiceModel {
  const { supply_type, place_of_supply } = resolveSupplyType(
    input.seller,
    input.ship_to,
    input.bill_to,
    input.dispatch_from ?? null
  )

  const rows: TaxInvoiceRow[] = []
  const push = (
    kind: TaxInvoiceRow["kind"],
    description: string,
    hsn: string,
    quantity: number,
    total: number,
    taxTotal: number,
    rate: number
  ) => {
    const tax = round2(num(taxTotal))
    const taxable = round2(num(total) - num(taxTotal))
    const split = splitTax(tax, num(rate), supply_type)
    rows.push({
      sl: rows.length + 1,
      kind,
      description,
      hsn,
      quantity,
      unit_rate: quantity > 0 ? round2(taxable / quantity) : taxable,
      taxable,
      tax_rate: num(rate),
      ...split,
      total: round2(taxable + tax),
    })
  }

  for (const line of input.lines) {
    push(
      "goods",
      describe(line),
      String(line.hs_code ?? "").trim(),
      num(line.quantity),
      line.total,
      line.tax_total,
      line.tax_rate
    )
  }
  for (const charge of input.charges) {
    // A free pickup or zero-rated shipping prints nothing rather than a 0.00 row.
    if (round2(num(charge.total)) === 0) continue
    push("charge", charge.name, "", 1, charge.total, charge.tax_total, charge.tax_rate)
  }

  const sum = (pick: (r: TaxInvoiceRow) => number) =>
    round2(rows.reduce((acc, r) => acc + pick(r), 0))
  const taxable = sum((r) => r.taxable)
  const cgst = sum((r) => r.cgst)
  const sgst = sum((r) => r.sgst)
  const igst = sum((r) => r.igst)
  const tax = round2(cgst + sgst + igst)

  const grand_total = round2(num(input.order.total))
  const round_off = round2(grand_total - (taxable + tax))
  if (Math.abs(round_off) > MAX_ROUND_OFF) {
    throw new Error(
      `Invoice lines add up to ${round2(taxable + tax)} but the order total is ${grand_total}. Not issuing an invoice that disagrees with what was charged.`
    )
  }

  const paid = round2(num(input.order.paid_total))
  const balance_due = round2(Math.max(0, grand_total - paid))

  const notes: string[] = []
  if (supply_type === "export") {
    notes.push(
      tax === 0
        ? input.export_lut_arn
          ? `Supply meant for export under LUT (ARN ${input.export_lut_arn}) without payment of IGST.`
          : "Supply meant for export."
        : "Supply meant for export on payment of IGST."
    )
  }
  if (rows.some((r) => r.kind === "goods" && !r.hsn)) {
    notes.push("HSN not recorded for one or more items.")
  }

  const party = (p: TaxInvoiceParty | null) =>
    p ? { name: p.name, lines: p.lines } : null

  return {
    title: "Tax Invoice",
    invoice_number: input.invoice_number,
    invoice_date: input.invoice_date,
    order_id: input.order.id,
    order_ref:
      input.order.display_id != null ? `#${input.order.display_id}` : input.order.id,
    order_date: input.order.created_at,
    currency_code: input.order.currency_code,
    seller: {
      legal_name: input.seller.legal_name,
      gstin: input.seller.gstin,
      lines: input.seller.address.lines,
    },
    // A bill-to with no name (a bare country) falls back to the ship-to.
    bill_to: party(input.bill_to?.name ? input.bill_to : input.ship_to) ?? {
      name: "Customer",
      lines: [],
    },
    ship_to: party(input.ship_to),
    buyer_gstin: input.buyer_gstin?.trim() || null,
    supply_type,
    place_of_supply,
    rows,
    totals: {
      taxable,
      cgst,
      sgst,
      igst,
      tax,
      round_off,
      grand_total,
      paid,
      balance_due,
    },
    amount_in_words: amountInWords(grand_total, input.order.currency_code),
    notes,
  }
}

/**
 * PURE: the Indian financial year (April–March) a date falls in, as "2026-27".
 */
export function financialYearOf(date: Date): string {
  // IST is UTC+5:30, so 31 March 18:30 UTC is already 1 April in India.
  const ist = new Date(date.getTime() + 330 * 60 * 1000)
  const start = ist.getUTCMonth() >= 3 ? ist.getUTCFullYear() : ist.getUTCFullYear() - 1
  return `${start}-${String((start + 1) % 100).padStart(2, "0")}`
}

export const INVOICE_PREFIX = "JYT"

/**
 * PURE: "JYT/2026-27/0001" — 16 characters, the GST limit, up to sequence 9999.
 */
export function formatInvoiceNumber(financialYear: string, sequence: number): string {
  return `${INVOICE_PREFIX}/${financialYear}/${String(sequence).padStart(4, "0")}`
}
