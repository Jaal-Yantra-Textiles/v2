import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib"

import type { InventoryOrderInvoiceModel } from "./inventory-order-invoice-model"

/**
 * Draw an inventory-order proforma as a one-or-more page A4 PDF.
 *
 * Holds NO arithmetic: every number it prints was computed and tested in
 * `inventory-order-invoice-model`. This file only decides where things sit, so
 * a layout change can never alter a total.
 *
 * Server-side pdf-lib, the same way `/admin/inventory-items/:id/labels` builds
 * its barcode label — rather than a client-side generator, because the partner
 * portal and the admin must produce the identical document and a browser-only
 * path would give us two.
 */

const A4: [number, number] = [595.28, 841.89]
const MARGIN = 40
const INK = rgb(0.1, 0.1, 0.1)
const MUTED = rgb(0.42, 0.42, 0.42)
const RULE = rgb(0.75, 0.75, 0.75)
const BAND = rgb(0.93, 0.93, 0.93)

/** Column x-offsets, measured from the left margin. */
const COL = {
  sl: 0,
  description: 26,
  hsn: 268,
  qty: 322,
  rate: 400,
  amountRight: 515, // right edge for right-aligned money
}

const money = (value: number): string =>
  value.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/**
 * pdf-lib throws on any character outside WinAnsi, and the fabric names here
 * are full of them — the em dash in "Matka — Earthy Tone" above all. One
 * unmapped glyph would fail the whole document, so substitute rather than
 * throw: a dash printed as "-" is a cosmetic loss, a 500 on the invoice route
 * is not.
 */
const sanitize = (text: string): string =>
  String(text ?? "")
    .replace(/[‐-―]/g, "-")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/₹/g, "Rs.")
    .replace(/[^\x20-\x7E]/g, "")

const drawRight = (
  page: PDFPage,
  text: string,
  right: number,
  y: number,
  font: PDFFont,
  size: number,
  color = INK
) => {
  const clean = sanitize(text)
  page.drawText(clean, {
    x: right - font.widthOfTextAtSize(clean, size),
    y,
    size,
    font,
    color,
  })
}

const drawLeft = (
  page: PDFPage,
  text: string,
  x: number,
  y: number,
  font: PDFFont,
  size: number,
  color = INK,
  maxWidth?: number
) => {
  page.drawText(sanitize(text), {
    x,
    y,
    size,
    font,
    color,
    // pdf-lib defaults a wrapped block to the FONT's line height, which at 8pt
    // leaves a gap wide enough to read as a paragraph break. Set it explicitly
    // or the provenance note looks like two unrelated sentences.
    ...(maxWidth ? { maxWidth, lineHeight: size * 1.35 } : {}),
  })
}

export const renderInventoryOrderInvoicePdf = async (
  model: InventoryOrderInvoiceModel
): Promise<Uint8Array> => {
  const pdf = await PDFDocument.create()
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold)
  const regular = await pdf.embedFont(StandardFonts.Helvetica)
  const italic = await pdf.embedFont(StandardFonts.HelveticaOblique)

  let page = pdf.addPage(A4)
  const width = A4[0]
  const left = MARGIN
  let y = A4[1] - MARGIN

  const newPage = () => {
    page = pdf.addPage(A4)
    y = A4[1] - MARGIN
  }

  // ── Header ────────────────────────────────────────────────────────────────
  drawLeft(page, model.title, left, y - 4, bold, 18)
  drawRight(page, model.invoiceDate, width - MARGIN, y - 4, regular, 10, MUTED)
  y -= 26

  drawLeft(page, model.supplier.name, left, y, bold, 12)
  y -= 14
  if (model.supplier.taxId) {
    drawLeft(page, `${model.supplier.taxIdLabel}: ${model.supplier.taxId}`, left, y, regular, 9, MUTED)
    y -= 12
  }
  if (model.supplier.countryCode) {
    drawLeft(page, `Country: ${model.supplier.countryCode}`, left, y, regular, 9, MUTED)
    y -= 12
  }

  y -= 8
  page.drawLine({
    start: { x: left, y },
    end: { x: width - MARGIN, y },
    thickness: 0.7,
    color: RULE,
  })
  y -= 18

  // ── Bill to / order reference, side by side ───────────────────────────────
  const rightColX = left + 300
  const blockTop = y

  drawLeft(page, "DELIVER TO", left, y, bold, 9, MUTED)
  y -= 13
  drawLeft(page, model.billTo.name, left, y, bold, 10)
  y -= 12
  for (const line of model.billTo.lines) {
    drawLeft(page, line, left, y, regular, 9, MUTED)
    y -= 11
  }

  let ry = blockTop
  drawLeft(page, "REFERENCE", rightColX, ry, bold, 9, MUTED)
  ry -= 13
  drawLeft(page, model.reference, rightColX, ry, regular, 9)
  ry -= 12
  if (model.orderDate) {
    drawLeft(page, `Order date: ${model.orderDate}`, rightColX, ry, regular, 9, MUTED)
    ry -= 11
  }
  if (model.expectedDeliveryDate) {
    drawLeft(page, `Expected: ${model.expectedDeliveryDate}`, rightColX, ry, regular, 9, MUTED)
    ry -= 11
  }

  y = Math.min(y, ry) - 16

  // ── Line table ────────────────────────────────────────────────────────────
  const drawTableHead = () => {
    page.drawRectangle({
      x: left,
      y: y - 4,
      width: width - MARGIN * 2,
      height: 18,
      color: BAND,
    })
    const hy = y + 1
    drawLeft(page, "#", left + COL.sl + 3, hy, bold, 8)
    drawLeft(page, "DESCRIPTION", left + COL.description, hy, bold, 8)
    drawLeft(page, "HSN", left + COL.hsn, hy, bold, 8)
    drawLeft(page, "QTY", left + COL.qty, hy, bold, 8)
    drawLeft(page, "RATE", left + COL.rate, hy, bold, 8)
    drawRight(page, "AMOUNT", left + COL.amountRight, hy, bold, 8)
    y -= 24
  }

  drawTableHead()

  for (const row of model.rows) {
    if (y < MARGIN + 140) {
      newPage()
      drawTableHead()
    }
    drawLeft(page, String(row.sl), left + COL.sl + 3, y, regular, 9, MUTED)
    drawLeft(page, row.description, left + COL.description, y, regular, 9, INK, 234)
    drawLeft(page, row.hsCode || "-", left + COL.hsn, y, regular, 9, MUTED)
    drawLeft(page, `${row.quantity} ${row.unit}`, left + COL.qty, y, regular, 9)
    drawLeft(page, row.rateLabel, left + COL.rate, y, regular, 9)
    drawRight(page, money(row.amount), left + COL.amountRight, y, regular, 9)
    y -= 16
  }

  // ── Totals ────────────────────────────────────────────────────────────────
  if (y < MARGIN + 150) newPage()

  y -= 4
  page.drawLine({
    start: { x: left + 300, y },
    end: { x: width - MARGIN, y },
    thickness: 0.7,
    color: RULE,
  })
  y -= 16

  const totalRow = (label: string, value: string, strong = false) => {
    drawLeft(page, label, left + 300, y, strong ? bold : regular, strong ? 10 : 9, strong ? INK : MUTED)
    drawRight(page, value, left + COL.amountRight, y, strong ? bold : regular, strong ? 10 : 9)
    y -= 15
  }

  totalRow("Goods total", money(model.totals.goods))
  for (const charge of model.totals.charges) {
    totalRow(charge.label, `${charge.raises ? "" : "-"}${money(charge.amount)}`)
  }

  y -= 2
  page.drawLine({
    start: { x: left + 300, y: y + 10 },
    end: { x: width - MARGIN, y: y + 10 },
    thickness: 0.7,
    color: RULE,
  })
  totalRow("GRAND TOTAL", money(model.totals.grandTotal), true)

  y -= 8
  drawLeft(page, model.amountInWords, left, y, italic, 9)
  y -= 28

  // ── Provenance + signature ────────────────────────────────────────────────
  drawLeft(page, model.provenanceNote, left, y, regular, 8, MUTED, width - MARGIN * 2)
  y -= 44

  page.drawLine({
    start: { x: left, y },
    end: { x: left + 170, y },
    thickness: 0.6,
    color: RULE,
  })
  page.drawLine({
    start: { x: width - MARGIN - 170, y },
    end: { x: width - MARGIN, y },
    thickness: 0.6,
    color: RULE,
  })
  y -= 12
  drawLeft(page, "Supplier signature", left, y, regular, 8, MUTED)
  drawRight(page, "Received by", width - MARGIN, y, regular, 8, MUTED)

  return pdf.save()
}
