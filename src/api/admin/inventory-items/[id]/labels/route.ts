import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { PDFDocument, StandardFonts, rgb } from "pdf-lib"
import bwipjs from "bwip-js"

/**
 * GET /admin/inventory-items/:id/labels
 *
 * Generates a printable barcode label PDF (4×2 inches) for the inventory item.
 * Includes a Code128 barcode of the SKU plus material details.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const { id } = req.params
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  const { data: items } = await query.graph({
    entity: "inventory_item",
    filters: { id },
    fields: [
      "id",
      "sku",
      "title",
      "raw_materials.*",
      "raw_materials.material_type.*",
    ],
  })

  const inventoryItem = items?.[0]
  if (!inventoryItem) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, `Inventory item "${id}" not found`)
  }

  const sku = inventoryItem.sku
  if (!sku) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Inventory item has no SKU. Create a raw material first to auto-generate one."
    )
  }

  const rawMaterial = (inventoryItem as any).raw_materials
  const materialName = rawMaterial?.name || inventoryItem.title || "Unknown"
  const composition = rawMaterial?.composition || ""
  const materialType = rawMaterial?.material_type?.name || ""

  // Generate Code128 barcode as PNG buffer
  const barcodePng = await bwipjs.toBuffer({
    bcid: "code128",
    text: sku,
    scale: 3,
    height: 12,
    includetext: true,
    textxalign: "center",
    textsize: 10,
  })

  // Build the PDF label (4×2 inches = 288×144 points)
  const LABEL_W = 288
  const LABEL_H = 144

  const pdfDoc = await PDFDocument.create()
  const page = pdfDoc.addPage([LABEL_W, LABEL_H])

  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold)
  const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica)

  // Embed the barcode image
  const barcodeImage = await pdfDoc.embedPng(barcodePng)
  const barcodeScale = barcodeImage.scaleToFit(220, 50)

  // Layout: barcode centered at top, text below
  const barcodeX = (LABEL_W - barcodeScale.width) / 2
  const barcodeY = LABEL_H - 10 - barcodeScale.height

  page.drawImage(barcodeImage, {
    x: barcodeX,
    y: barcodeY,
    width: barcodeScale.width,
    height: barcodeScale.height,
  })

  // Text area below barcode
  let textY = barcodeY - 16

  // Material name (bold)
  page.drawText(materialName, {
    x: 12,
    y: textY,
    size: 11,
    font: fontBold,
    color: rgb(0, 0, 0),
    maxWidth: LABEL_W - 24,
  })
  textY -= 14

  // Material type
  if (materialType) {
    page.drawText(`Type: ${materialType}`, {
      x: 12,
      y: textY,
      size: 8,
      font: fontRegular,
      color: rgb(0.3, 0.3, 0.3),
      maxWidth: LABEL_W - 24,
    })
    textY -= 12
  }

  // Composition
  if (composition) {
    page.drawText(composition, {
      x: 12,
      y: textY,
      size: 8,
      font: fontRegular,
      color: rgb(0.3, 0.3, 0.3),
      maxWidth: LABEL_W - 24,
    })
  }

  const pdfBytes = await pdfDoc.save()

  res.setHeader("Content-Type", "application/pdf")
  res.setHeader("Content-Disposition", `inline; filename="label-${sku}.pdf"`)
  res.end(Buffer.from(pdfBytes))
}
