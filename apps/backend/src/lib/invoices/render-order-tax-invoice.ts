import { PDFDocument, StandardFonts } from "pdf-lib"

import type { OrderTaxInvoiceModel } from "./order-tax-invoice-model"
import {
  A4,
  BAND,
  INK,
  MARGIN,
  MUTED,
  RULE,
  drawLeft,
  drawRight,
  money,
} from "./render-inventory-order-invoice"

/**
 * Draw a GST tax invoice (#2532) as an A4 PDF. Holds NO arithmetic: every number
 * comes from `buildOrderTaxInvoiceModel`, so a layout change cannot alter a
 * total. Shares its drawing helpers with the inventory-order proforma.
 */

/** Column positions from the left margin; `*R` are right edges for numbers. */
const COL = {
  sl: 0,
  description: 20,
  hsn: 192,
  qtyR: 262,
  rateR: 322,
  taxableR: 386,
  gstR: 420,
  taxR: 468,
  totalR: 515,
}

const SUPPLY_LABEL: Record<OrderTaxInvoiceModel["supply_type"], string> = {
  intra_state: "Intra-state (CGST + SGST)",
  inter_state: "Inter-state (IGST)",
  export: "Export",
}

const fmtDate = (iso: string | null): string => {
  if (!iso) return "-"
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })
}

export const renderOrderTaxInvoicePdf = async (
  model: OrderTaxInvoiceModel
): Promise<Uint8Array> => {
  const pdf = await PDFDocument.create()
  pdf.setTitle(`${model.title} ${model.invoice_number ?? "(preview)"}`)
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold)
  const regular = await pdf.embedFont(StandardFonts.Helvetica)
  const italic = await pdf.embedFont(StandardFonts.HelveticaOblique)

  let page = pdf.addPage(A4)
  const width = A4[0]
  const left = MARGIN
  const right = width - MARGIN
  let y = A4[1] - MARGIN
  const currency = model.currency_code.toUpperCase()

  const rule = (from = left) => {
    page.drawLine({ start: { x: from, y }, end: { x: right, y }, thickness: 0.7, color: RULE })
  }

  // ── Header: title + number/date ───────────────────────────────────────────
  drawLeft(page, model.title.toUpperCase(), left, y - 4, bold, 18)
  drawRight(
    page,
    model.invoice_number ? `Invoice No: ${model.invoice_number}` : "PREVIEW - NOT ISSUED",
    right,
    y,
    bold,
    10
  )
  drawRight(page, `Date: ${fmtDate(model.invoice_date)}`, right, y - 13, regular, 9, MUTED)
  y -= 30

  // ── Seller ────────────────────────────────────────────────────────────────
  drawLeft(page, model.seller.legal_name, left, y, bold, 12)
  y -= 13
  for (const line of model.seller.lines) {
    drawLeft(page, line, left, y, regular, 9, MUTED)
    y -= 11
  }
  if (model.seller.gstin) {
    drawLeft(page, `GSTIN: ${model.seller.gstin}`, left, y, bold, 9)
    y -= 11
  }
  y -= 6
  rule()
  y -= 16

  // ── Bill to | Ship to | Invoice details ───────────────────────────────────
  const blockTop = y
  const party = (
    heading: string,
    p: { name: string; lines: string[] },
    x: number,
    extra?: string | null
  ): number => {
    let py = blockTop
    drawLeft(page, heading, x, py, bold, 8, MUTED)
    py -= 12
    drawLeft(page, p.name, x, py, bold, 9, INK, 150)
    py -= 11
    for (const line of p.lines) {
      drawLeft(page, line, x, py, regular, 8, MUTED, 150)
      py -= 10
    }
    if (extra) {
      drawLeft(page, extra, x, py, bold, 8)
      py -= 10
    }
    return py
  }
  const y1 = party(
    "BILL TO",
    model.bill_to,
    left,
    model.buyer_gstin ? `GSTIN: ${model.buyer_gstin}` : null
  )
  const y2 = model.ship_to ? party("SHIP TO", model.ship_to, left + 170) : blockTop

  let ry = blockTop
  const detail = (label: string, value: string) => {
    drawLeft(page, label, left + 340, ry, regular, 8, MUTED)
    drawRight(page, value, right, ry, regular, 8)
    ry -= 11
  }
  drawLeft(page, "DETAILS", left + 340, ry, bold, 8, MUTED)
  ry -= 12
  detail("Order", model.order_ref)
  detail("Order date", fmtDate(model.order_date))
  detail("Place of supply", model.place_of_supply)
  detail("Supply", SUPPLY_LABEL[model.supply_type])
  detail("Currency", currency)

  y = Math.min(y1, y2, ry) - 14

  // ── Line table ────────────────────────────────────────────────────────────
  const taxHead = model.supply_type === "intra_state" ? "CGST+SGST" : "IGST"
  const drawTableHead = () => {
    page.drawRectangle({ x: left, y: y - 4, width: right - left, height: 18, color: BAND })
    const hy = y + 1
    drawLeft(page, "#", left + COL.sl + 3, hy, bold, 7)
    drawLeft(page, "DESCRIPTION", left + COL.description, hy, bold, 7)
    drawLeft(page, "HSN", left + COL.hsn, hy, bold, 7)
    drawRight(page, "QTY", left + COL.qtyR, hy, bold, 7)
    drawRight(page, "RATE", left + COL.rateR, hy, bold, 7)
    drawRight(page, "TAXABLE", left + COL.taxableR, hy, bold, 7)
    drawRight(page, "GST%", left + COL.gstR, hy, bold, 7)
    drawRight(page, taxHead, left + COL.taxR, hy, bold, 7)
    drawRight(page, "TOTAL", left + COL.totalR, hy, bold, 7)
    y -= 22
  }
  drawTableHead()

  for (const row of model.rows) {
    if (y < MARGIN + 190) {
      page = pdf.addPage(A4)
      y = A4[1] - MARGIN
      drawTableHead()
    }
    const tax = row.cgst + row.sgst + row.igst
    drawLeft(page, String(row.sl), left + COL.sl + 3, y, regular, 8, MUTED)
    drawLeft(page, row.description, left + COL.description, y, regular, 8, INK, 168)
    drawLeft(page, row.hsn || "-", left + COL.hsn, y, regular, 8, MUTED)
    drawRight(page, String(row.quantity), left + COL.qtyR, y, regular, 8)
    drawRight(page, money(row.unit_rate), left + COL.rateR, y, regular, 8)
    drawRight(page, money(row.taxable), left + COL.taxableR, y, regular, 8)
    drawRight(page, `${row.tax_rate}%`, left + COL.gstR, y, regular, 8, MUTED)
    drawRight(page, money(tax), left + COL.taxR, y, regular, 8)
    drawRight(page, money(row.total), left + COL.totalR, y, regular, 8)
    // Long descriptions wrap onto a second line.
    y -= row.description.length > 42 ? 24 : 15
  }

  // ── Totals ────────────────────────────────────────────────────────────────
  if (y < MARGIN + 190) {
    page = pdf.addPage(A4)
    y = A4[1] - MARGIN
  }
  y -= 2
  rule(left + 300)
  y -= 15

  const totalRow = (label: string, value: number, strong = false) => {
    drawLeft(page, label, left + 300, y, strong ? bold : regular, strong ? 10 : 9, strong ? INK : MUTED)
    drawRight(
      page,
      strong ? `${currency} ${money(value)}` : money(value),
      right,
      y,
      strong ? bold : regular,
      strong ? 10 : 9
    )
    y -= 14
  }
  const t = model.totals
  totalRow("Taxable value", t.taxable)
  if (model.supply_type === "intra_state") {
    totalRow("CGST", t.cgst)
    totalRow("SGST", t.sgst)
  } else {
    totalRow("IGST", t.igst)
  }
  if (t.round_off !== 0) totalRow("Round off", t.round_off)
  y -= 2
  rule(left + 300)
  y -= 14
  totalRow("GRAND TOTAL", t.grand_total, true)
  totalRow("Paid", t.paid)
  if (t.balance_due > 0) totalRow("Balance due", t.balance_due, true)

  y -= 6
  drawLeft(page, `Amount in words: ${model.amount_in_words}`, left, y, italic, 9, INK, right - left)
  y -= 22

  for (const note of model.notes) {
    drawLeft(page, note, left, y, regular, 8, MUTED, right - left)
    y -= 12
  }

  // ── Footer ────────────────────────────────────────────────────────────────
  // Pinned to the bottom of the page; a page with no room left gets its own.
  if (y - 24 < MARGIN + 60) page = pdf.addPage(A4)
  y = MARGIN + 60
  drawRight(page, `For ${model.seller.legal_name}`, right, y, bold, 9)
  y -= 34
  page.drawLine({ start: { x: right - 160, y }, end: { x: right, y }, thickness: 0.6, color: RULE })
  y -= 11
  drawRight(page, "Authorised signatory", right, y, regular, 8, MUTED)
  drawLeft(
    page,
    "This is a computer-generated invoice.",
    left,
    y,
    regular,
    8,
    MUTED
  )

  return pdf.save()
}
