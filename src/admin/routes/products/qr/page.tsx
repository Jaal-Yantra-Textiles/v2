import {
  Container,
  Heading,
  Text,
  DataTable,
  useDataTable,
  DataTablePaginationState,
  DataTableFilteringState,
  CommandBar,
  Checkbox,
  Badge,
  toast,
  createDataTableFilterHelper,
} from "@medusajs/ui"
import { defineRouteConfig } from "@medusajs/admin-sdk"
import { Outlet } from "react-router-dom"
import { keepPreviousData } from "@tanstack/react-query"
import { useState, useMemo, useEffect, useCallback } from "react"
import debounce from "lodash/debounce"
import { Tag } from "@medusajs/icons"
import { useProducts } from "../../../hooks/api/products"
import { getProductUrlFromHandle } from "../../../lib/storefront-url"
import { sdk } from "../../../lib/config"

// Minimal shape we rely on in the table
type AdminProductRow = {
  id: string
  title?: string | null
  handle?: string | null
  status?: string | null
  thumbnail?: string | null
  created_at?: string
}

// ─── Hang Tag PDF generation (client-side, uses pdf-lib + qrcode) ─────────────

type HangTagData = {
  product: {
    id: string
    title: string
    handle: string
    description?: string
    status?: string
    storefront_url: string
    tags?: string[]
    people?: Array<{ first_name?: string; last_name?: string; email?: string }>
    designs?: Array<{
      id: string
      name: string
      description?: string
      status?: string
      design_type?: string
      tags?: string[]
      color_palette?: Array<{ name: string; code?: string; value?: string }>
      partners?: Array<{
        name: string
        people?: Array<{ first_name?: string; last_name?: string; email?: string }>
      }>
    }>
  }
}

async function fetchHangTagData(productId: string): Promise<HangTagData> {
  return sdk.client.fetch<HangTagData>(`/admin/products/${productId}/hang-tag`)
}

// Points → mm helpers (1 pt = 0.352778 mm, 1 mm = 2.83465 pt)
const mm = (v: number) => v * 2.83465

/** Wrap text to lines that fit within maxWidth at a given font size */
async function measureWidth(text: string, font: any, size: number): Promise<number> {
  return font.widthOfTextAtSize(text, size)
}

function truncate(text: string, font: any, size: number, maxWidth: number): string {
  let t = text
  while (t.length > 0 && font.widthOfTextAtSize(t, size) > maxWidth) {
    t = t.slice(0, -1)
  }
  if (t !== text) t = t.trimEnd() + "…"
  return t
}

function wrapText(text: string, font: any, size: number, maxWidth: number): string[] {
  const words = text.split(" ")
  const lines: string[] = []
  let line = ""
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
      line = candidate
    } else {
      if (line) lines.push(line)
      line = word
    }
  }
  if (line) lines.push(line)
  return lines
}

async function generateHangTagPdf(data: HangTagData): Promise<Uint8Array> {
  const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib")
  const { toDataURL } = await import("qrcode")

  // Tag dimensions: 55mm × 90mm (standard clothing hang tag)
  const W = mm(55)
  const H = mm(90)
  const MARGIN = mm(4)
  const INNER_W = W - MARGIN * 2

  const pdfDoc = await PDFDocument.create()
  const page = pdfDoc.addPage([W, H])

  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold)
  const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica)
  const fontOblique = await pdfDoc.embedFont(StandardFonts.HelveticaOblique)

  const { product } = data

  // ── Background ──────────────────────────────────────────────────────────────
  page.drawRectangle({ x: 0, y: 0, width: W, height: H, color: rgb(1, 1, 1) })

  // ── Top accent bar ──────────────────────────────────────────────────────────
  const BAR_H = mm(8)
  page.drawRectangle({ x: 0, y: H - BAR_H, width: W, height: BAR_H, color: rgb(0.05, 0.05, 0.05) })

  // Brand / store name in bar
  const brandName = "JYT"
  const brandSize = 10
  const brandW = fontBold.widthOfTextAtSize(brandName, brandSize)
  page.drawText(brandName, {
    x: (W - brandW) / 2,
    y: H - BAR_H + (BAR_H - brandSize) / 2 + 1,
    size: brandSize,
    font: fontBold,
    color: rgb(1, 1, 1),
  })

  // Punch hole circle (visual only)
  page.drawCircle({ x: W / 2, y: H - BAR_H - mm(5), size: mm(2), color: rgb(0.85, 0.85, 0.85) })
  page.drawCircle({ x: W / 2, y: H - BAR_H - mm(5), size: mm(2), borderColor: rgb(0.6, 0.6, 0.6), borderWidth: 0.5 })

  let y = H - BAR_H - mm(12)

  // ── Product title ───────────────────────────────────────────────────────────
  const titleLines = wrapText(product.title ?? "Untitled", fontBold, 9, INNER_W)
  for (const line of titleLines.slice(0, 2)) {
    page.drawText(line, { x: MARGIN, y, size: 9, font: fontBold, color: rgb(0.05, 0.05, 0.05) })
    y -= 11
  }

  // ── Status badge (small label) ──────────────────────────────────────────────
  if (product.status) {
    const statusLabel = product.status.charAt(0).toUpperCase() + product.status.slice(1)
    const sSize = 6.5
    const sW = fontRegular.widthOfTextAtSize(statusLabel, sSize) + mm(3)
    const sH = mm(3.5)
    page.drawRectangle({ x: MARGIN, y: y - sH + mm(1), width: sW, height: sH, color: rgb(0.9, 0.9, 0.9) })
    page.drawText(statusLabel, { x: MARGIN + mm(1.5), y: y - sH + mm(1.5), size: sSize, font: fontRegular, color: rgb(0.3, 0.3, 0.3) })
    y -= sH + mm(3)
  } else {
    y -= mm(2)
  }

  // ── Divider ─────────────────────────────────────────────────────────────────
  page.drawLine({ start: { x: MARGIN, y }, end: { x: W - MARGIN, y }, thickness: 0.4, color: rgb(0.85, 0.85, 0.85) })
  y -= mm(3)

  // ── Designs section ─────────────────────────────────────────────────────────
  const designs = product.designs ?? []
  if (designs.length > 0) {
    const d = designs[0]

    // Label
    page.drawText("Design", { x: MARGIN, y, size: 6, font: fontBold, color: rgb(0.5, 0.5, 0.5) })
    y -= mm(3.5)

    // Design name
    const dName = truncate(d.name ?? "", fontBold, 8, INNER_W)
    page.drawText(dName, { x: MARGIN, y, size: 8, font: fontBold, color: rgb(0.1, 0.1, 0.1) })
    y -= 10

    // Design type
    if (d.design_type) {
      page.drawText(d.design_type.replace(/_/g, " "), { x: MARGIN, y, size: 6.5, font: fontOblique, color: rgb(0.45, 0.45, 0.45) })
      y -= 9
    }

    // Partners
    const partners = d.partners ?? []
    if (partners.length > 0) {
      page.drawText("Made by", { x: MARGIN, y, size: 6, font: fontBold, color: rgb(0.5, 0.5, 0.5) })
      y -= mm(3.5)
      for (const p of partners.slice(0, 2)) {
        const pName = truncate(p.name ?? "", fontRegular, 7.5, INNER_W)
        page.drawText(pName, { x: MARGIN, y, size: 7.5, font: fontRegular, color: rgb(0.1, 0.1, 0.1) })
        y -= 9

        // Partner people
        const people = p.people ?? []
        for (const person of people.slice(0, 2)) {
          const pPersonName = [person.first_name, person.last_name].filter(Boolean).join(" ")
          if (pPersonName) {
            const personLine = truncate(`> ${pPersonName}`, fontRegular, 6.5, INNER_W - mm(2))
            page.drawText(personLine, { x: MARGIN + mm(2), y, size: 6.5, font: fontRegular, color: rgb(0.4, 0.4, 0.4) })
            y -= 8
          }
        }
      }
    }

    // Color palette dots
    const palette = d.color_palette ?? []
    if (palette.length > 0) {
      y -= mm(1)
      const DOT = mm(2.5)
      let cx = MARGIN
      for (const c of palette.slice(0, 8)) {
        const hex = c.code ?? c.value ?? "#cccccc"
        const hexClean = hex.replace("#", "")
        const r = parseInt(hexClean.slice(0, 2), 16) / 255
        const g = parseInt(hexClean.slice(2, 4), 16) / 255
        const b = parseInt(hexClean.slice(4, 6), 16) / 255
        const safeR = isNaN(r) ? 0.8 : r
        const safeG = isNaN(g) ? 0.8 : g
        const safeB = isNaN(b) ? 0.8 : b
        page.drawCircle({ x: cx + DOT / 2, y: y - DOT / 2, size: DOT / 2, color: rgb(safeR, safeG, safeB) })
        page.drawCircle({ x: cx + DOT / 2, y: y - DOT / 2, size: DOT / 2, borderColor: rgb(0.7, 0.7, 0.7), borderWidth: 0.3 })
        cx += DOT + mm(1)
      }
      y -= DOT + mm(2)
    }

    // Design tags
    const dTags = Array.isArray(d.tags) ? d.tags : []
    if (dTags.length > 0) {
      const tagStr = truncate(dTags.slice(0, 4).join("  ·  "), fontOblique, 6, INNER_W)
      page.drawText(tagStr, { x: MARGIN, y, size: 6, font: fontOblique, color: rgb(0.5, 0.5, 0.5) })
      y -= 8
    }

    y -= mm(1)
  }

  // ── Direct people linked to product ─────────────────────────────────────────
  const directPeople = (product.people ?? []).slice(0, 2)
  if (directPeople.length > 0) {
    page.drawText("Collaborators", { x: MARGIN, y, size: 6, font: fontBold, color: rgb(0.5, 0.5, 0.5) })
    y -= mm(3.5)
    for (const person of directPeople) {
      const name = [person.first_name, person.last_name].filter(Boolean).join(" ")
      if (name) {
        page.drawText(truncate(name, fontRegular, 7, INNER_W), { x: MARGIN, y, size: 7, font: fontRegular, color: rgb(0.2, 0.2, 0.2) })
        y -= 9
      }
    }
    y -= mm(1)
  }

  // ── Bottom section: QR code ─────────────────────────────────────────────────
  const QR_SIZE = mm(18)
  const QR_Y = MARGIN + mm(1)

  // QR code
  const qrDataUrl: string = await toDataURL(product.storefront_url, {
    width: 200,
    margin: 1,
    color: { dark: "#111111", light: "#ffffff" },
  })
  const qrBase64 = qrDataUrl.split(",")[1]
  const qrImageBytes = Uint8Array.from(atob(qrBase64), (c) => c.charCodeAt(0))
  const qrImage = await pdfDoc.embedPng(qrImageBytes)
  page.drawImage(qrImage, { x: W - MARGIN - QR_SIZE, y: QR_Y, width: QR_SIZE, height: QR_SIZE })

  // Handle text beneath QR
  const handleStr = `/${product.handle}`
  const handleSize = 5
  const handleW = fontRegular.widthOfTextAtSize(handleStr, handleSize)
  page.drawText(handleStr, {
    x: W - MARGIN - QR_SIZE + (QR_SIZE - handleW) / 2,
    y: QR_Y - mm(2.5),
    size: handleSize,
    font: fontOblique,
    color: rgb(0.5, 0.5, 0.5),
  })

  // "Scan me" label above QR
  const scanLabel = "scan me"
  const scanSize = 5.5
  const scanW = fontOblique.widthOfTextAtSize(scanLabel, scanSize)
  page.drawText(scanLabel, {
    x: W - MARGIN - QR_SIZE + (QR_SIZE - scanW) / 2,
    y: QR_Y + QR_SIZE + mm(1),
    size: scanSize,
    font: fontOblique,
    color: rgb(0.5, 0.5, 0.5),
  })

  // Bottom divider line
  page.drawLine({
    start: { x: MARGIN, y: QR_Y + QR_SIZE + mm(4) },
    end: { x: W - MARGIN, y: QR_Y + QR_SIZE + mm(4) },
    thickness: 0.4,
    color: rgb(0.85, 0.85, 0.85),
  })

  // "Handcrafted with care" tagline (bottom left, next to QR)
  const taglines = ["Handcrafted", "with care"]
  let tY = QR_Y + QR_SIZE - 1
  for (const line of taglines) {
    page.drawText(line, { x: MARGIN, y: tY, size: 6.5, font: fontOblique, color: rgb(0.4, 0.4, 0.4) })
    tY -= 8
  }

  return pdfDoc.save()
}

// ─── Main page component ──────────────────────────────────────────────────────

const QRGeneratorPage = () => {
  const [pagination, setPagination] = useState<DataTablePaginationState>({ pageSize: 10, pageIndex: 0 })
  const [filtering, setFiltering] = useState<DataTableFilteringState>({})
  const [search, setSearch] = useState<string>("")
  const [rowSelection, setRowSelection] = useState<Record<string, boolean>>({})
  const [isCommandBarOpen, setIsCommandBarOpen] = useState(false)
  const [isGeneratingQR, setIsGeneratingQR] = useState(false)
  const [isGeneratingTags, setIsGeneratingTags] = useState(false)

  // Defensive: ensure body never stays with pointer-events: none due to overlay race conditions
  useEffect(() => {
    const fix = () => {
      if (typeof document !== "undefined" && document.body?.style?.pointerEvents === "none") {
        document.body.style.pointerEvents = ""
      }
    }
    fix()
    const observer = new MutationObserver(fix)
    observer.observe(document.body, { attributes: true, attributeFilter: ["style"] })
    return () => observer.disconnect()
  }, [])

  const handleFilterChange = useCallback((newFilters: DataTableFilteringState) => {
    const cleaned: DataTableFilteringState = {}
    if (newFilters) {
      for (const [key, value] of Object.entries(newFilters)) {
        const isEmptyArray = Array.isArray(value) && value.length === 0
        const isEmptyVal = value === undefined || value === null || value === "" || isEmptyArray
        if (!isEmptyVal) {
          cleaned[key] = value
        }
      }
    }
    setFiltering(cleaned)
    setPagination((prev) => ({ ...prev, pageIndex: 0 }))
    setRowSelection({})
  }, [])

  const debouncedSetSearch = useMemo(
    () => debounce((val: string) => setSearch(val), 300),
    []
  )

  const handleSearchChange = useCallback(
    (newSearch: string) => {
      debouncedSetSearch(newSearch)
      setPagination((prev) => ({ ...prev, pageIndex: 0 }))
      setRowSelection({})
    },
    [debouncedSetSearch]
  )

  useEffect(() => {
    return () => { debouncedSetSearch.cancel() }
  }, [debouncedSetSearch])

  const offset = pagination.pageIndex * pagination.pageSize

  const productsQuery = useMemo(() => {
    const base: any = {
      limit: pagination.pageSize,
      offset,
      q: search || undefined,
    }
    if (filtering && Object.keys(filtering).length > 0) {
      for (const [key, value] of Object.entries(filtering)) {
        const isEmptyArray = Array.isArray(value) && value.length === 0
        const isEmptyVal = value === undefined || value === null || value === "" || isEmptyArray
        if (isEmptyVal) continue
        if (key === "status") base.status = value as string
      }
    }
    return base
  }, [pagination.pageSize, offset, search, filtering])

  const { products, count, isLoading, isError, error } = useProducts(
    productsQuery,
    { placeholderData: keepPreviousData }
  ) as any

  const tableRows: AdminProductRow[] = useMemo(() => products ?? [], [products])

  const filteredRows: AdminProductRow[] = useMemo(() => {
    const rows = tableRows
    if (!filtering || Object.keys(filtering).length === 0) return rows
    return rows.filter((row: any) => {
      return Object.entries(filtering).every(([key, value]) => {
        if (!value) return true
        const v = row[key as keyof AdminProductRow] as any
        if (typeof value === "string") return (v ?? "").toString().toLowerCase().includes(value.toString().toLowerCase())
        if (Array.isArray(value)) return value.includes(((v ?? "") as string).toString().toLowerCase())
        if (typeof value === "object") {
          const date = v ? new Date(v) : null
          if (!date || isNaN(date.getTime())) return false
          let matching = true
          if ("$gte" in value && value.$gte) matching = matching && date >= new Date(value.$gte as number)
          if ("$lte" in value && value.$lte) matching = matching && date <= new Date(value.$lte as number)
          if ("$lt" in value && value.$lt) matching = matching && date < new Date(value.$lt as number)
          if ("$gt" in value && value.$gt) matching = matching && date > new Date(value.$gt as number)
          return matching
        }
        return true
      })
    })
  }, [tableRows, filtering])

  useEffect(() => {
    const anySelected = Object.values(rowSelection).some(Boolean)
    setIsCommandBarOpen(anySelected)
  }, [rowSelection])

  const columns = useMemo(() => {
    return [
      {
        id: "select",
        header: "",
        cell: ({ row }: any) => {
          const id = row.id as string
          const checked = !!rowSelection[id]
          return (
            <Checkbox
              id={`select-${id}`}
              checked={checked}
              onCheckedChange={() => setRowSelection((prev) => ({ ...prev, [id]: !prev[id] }))}
            />
          )
        },
        enableSorting: false,
        size: 36,
      },
      {
        id: "thumbnail",
        header: "Product",
        cell: ({ row }: any) => {
          const src = row.original.thumbnail as string | undefined
          return src ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={src} alt="thumb" className="h-8 w-8 rounded object-cover" />
          ) : (
            <div className="h-8 w-8 rounded bg-ui-bg-subtle" />
          )
        },
      },
      {
        id: "title",
        header: "Title",
        accessorKey: "title",
        cell: ({ row }: any) => row.original.title || "—",
      },
      {
        id: "handle",
        header: "Handle",
        accessorKey: "handle",
        cell: ({ row }: any) => {
          const handle = row.original.handle
          return (
            <div className="flex items-center gap-x-2">
              <span>{handle || "—"}</span>
              {!handle && <Badge size="xsmall" color="orange">Missing</Badge>}
            </div>
          )
        },
      },
      {
        id: "status",
        header: "Status",
        accessorKey: "status",
      },
    ]
  }, [rowSelection])

  const filterHelper = createDataTableFilterHelper<AdminProductRow>()
  const filters = useMemo(() => [
    filterHelper.accessor("status", {
      type: "select",
      label: "Status",
      options: [
        { label: "Draft", value: "draft" },
        { label: "Published", value: "published" },
      ],
    }),
  ], [])

  const table = useDataTable({
    columns,
    data: filteredRows,
    getRowId: (row) => row.id,
    rowCount: count,
    isLoading,
    onRowClick: () => {},
    filters,
    pagination: { state: pagination, onPaginationChange: setPagination },
    search: { state: search, onSearchChange: handleSearchChange },
    filtering: { state: filtering, onFilteringChange: handleFilterChange },
    rowSelection: { state: rowSelection, onRowSelectionChange: setRowSelection },
  })

  // ── Action: generate QR ZIP (original) ───────────────────────────────────────
  const generateQRCodes = async () => {
    const selectedIds = Object.keys(rowSelection).filter((id) => rowSelection[id])
    if (selectedIds.length === 0) return

    const selectedProducts = tableRows.filter((p) => selectedIds.includes(p.id))
    const valid = selectedProducts.filter((p) => !!p.handle)
    const invalid = selectedProducts.filter((p) => !p.handle)

    if (invalid.length) toast.warning(`${invalid.length} product(s) missing handle will be skipped`)

    setIsGeneratingQR(true)
    try {
      const { default: JSZip } = await import("jszip")
      const { saveAs } = await import("file-saver")
      const { toDataURL } = await import("qrcode")
      const zip = new JSZip()
      for (const item of valid) {
        const url = getProductUrlFromHandle(item.handle as string)
        const dataUrl: string = await toDataURL(url, { width: 512, margin: 2 })
        const base64 = dataUrl.split(",")[1]
        zip.file(`${item.handle}.png`, base64, { base64: true })
      }
      const blob = await zip.generateAsync({ type: "blob" })
      saveAs(blob, `product-qrs-${Date.now()}.zip`)
      toast.success(`Generated ${valid.length} QR(s).`)
      setRowSelection({})
      setIsCommandBarOpen(false)
    } catch (e) {
      toast.error("Failed to generate QR codes")
    } finally {
      setIsGeneratingQR(false)
    }
  }

  // ── Action: generate hang tags PDF ───────────────────────────────────────────
  const generateHangTags = async () => {
    const selectedIds = Object.keys(rowSelection).filter((id) => rowSelection[id])
    if (selectedIds.length === 0) return

    const selectedProducts = tableRows.filter((p) => selectedIds.includes(p.id))
    const valid = selectedProducts.filter((p) => !!p.handle)
    const invalid = selectedProducts.filter((p) => !p.handle)

    if (invalid.length) toast.warning(`${invalid.length} product(s) missing handle will be skipped`)
    if (valid.length === 0) return

    setIsGeneratingTags(true)
    try {
      const { PDFDocument } = await import("pdf-lib")
      const { saveAs } = await import("file-saver")

      // Fetch hang tag data for all selected products in parallel
      const tagDataResults = await Promise.allSettled(
        valid.map((p) => fetchHangTagData(p.id))
      )

      if (valid.length === 1) {
        // Single product: open print preview in new tab
        const result = tagDataResults[0]
        if (result.status === "rejected") {
          toast.error(`Failed to fetch data for "${valid[0].title}"`)
          return
        }
        const pdfBytes = await generateHangTagPdf(result.value)
        const blob = new Blob([pdfBytes as BlobPart], { type: "application/pdf" })
        const url = URL.createObjectURL(blob)
        window.open(url, "_blank")
        toast.success("Hang tag opened for printing")
      } else {
        // Multiple: merge all tags into one printable PDF and download
        const mergedDoc = await PDFDocument.create()
        let successCount = 0

        for (let i = 0; i < tagDataResults.length; i++) {
          const result = tagDataResults[i]
          if (result.status === "rejected") {
            toast.warning(`Skipped "${valid[i].title}" — failed to fetch data`)
            continue
          }
          try {
            const pdfBytes = await generateHangTagPdf(result.value)
            const tagDoc = await PDFDocument.load(pdfBytes)
            const [page] = await mergedDoc.copyPages(tagDoc, [0])
            mergedDoc.addPage(page)
            successCount++
          } catch (err) {
            toast.warning(`Skipped "${valid[i].title}" — failed to generate tag`)
          }
        }

        if (successCount === 0) {
          toast.error("No hang tags could be generated")
          return
        }

        const mergedBytes = await mergedDoc.save()
        const blob = new Blob([mergedBytes as BlobPart], { type: "application/pdf" })
        saveAs(blob, `hang-tags-${Date.now()}.pdf`)
        toast.success(`Generated ${successCount} hang tag(s) — ready to print`)
      }

      setRowSelection({})
      setIsCommandBarOpen(false)
    } catch (e) {
      console.error(e)
      toast.error("Failed to generate hang tags")
    } finally {
      setIsGeneratingTags(false)
    }
  }

  if (isError) throw error

  const selectedCount = Object.values(rowSelection).filter(Boolean).length
  const isBusy = isGeneratingQR || isGeneratingTags

  return (
    <div>
      <Container className="divide-y p-0">
        <CommandBar open={isCommandBarOpen}>
          <CommandBar.Bar>
            <CommandBar.Value>{selectedCount} selected</CommandBar.Value>
            <CommandBar.Seperator />
            <CommandBar.Command
              action={generateHangTags}
              label={isGeneratingTags ? "Generating…" : "Hang Tags (PDF)"}
              disabled={isBusy}
              shortcut="h"
            />
            <CommandBar.Seperator />
            <CommandBar.Command
              action={generateQRCodes}
              label={isGeneratingQR ? "Generating…" : "QR Codes (ZIP)"}
              disabled={isBusy}
              shortcut="g"
            />
          </CommandBar.Bar>
        </CommandBar>

        <DataTable instance={table}>
          <DataTable.Toolbar className="flex flex-col md:flex-row justify-between gap-y-4 px-6 py-4">
            <div>
              <Heading>QR &amp; Hang Tag Generator</Heading>
              <Text className="text-ui-fg-subtle" size="small">
                Select products to generate QR codes or print-ready hang tags with design &amp; partner info
              </Text>
            </div>
            <div className="flex items-center gap-x-2">
              <div className="w-full sm:max-w-[260px] md:w-auto">
                <DataTable.Search placeholder="Search products..." />
              </div>
              <div onMouseDown={() => setRowSelection({})}>
                <DataTable.FilterMenu tooltip="Filter products" />
              </div>
            </div>
          </DataTable.Toolbar>
          <DataTable.Table />
          <DataTable.Pagination />
        </DataTable>
      </Container>
      <Outlet />
    </div>
  )
}

export default QRGeneratorPage

export const config = defineRouteConfig({
  label: "QR & Hang Tags",
  nested: "/products",
  icon: Tag,
})

export const handle = {
  breadcrumb: () => "QR & Hang Tags",
}
