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
import { CanvasEl, DEFAULT_HANG_TAG_CONFIG, HangTagConfig, computeFrontLayout, computeBackLayout, useHangTagSettings } from "../../../hooks/api/hang-tag-settings"

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

async function generateHangTagPdf(data: HangTagData, cfg: HangTagConfig = DEFAULT_HANG_TAG_CONFIG): Promise<Uint8Array> {
  const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib")
  const { toDataURL } = await import("qrcode")

  const W = mm(cfg.width_mm)
  const H = mm(cfg.height_mm)
  const MARGIN = mm(4)
  const INNER_W = W - MARGIN * 2

  const pdfDoc = await PDFDocument.create()
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold)
  const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica)
  const fontOblique = await pdfDoc.embedFont(StandardFonts.HelveticaOblique)

  const { product } = data

  const hexToRgb = (hex: string) => {
    const h = hex.replace("#", "")
    const r = parseInt(h.slice(0, 2), 16) / 255
    const g = parseInt(h.slice(2, 4), 16) / 255
    const b = parseInt(h.slice(4, 6), 16) / 255
    return rgb(isNaN(r) ? 0 : r, isNaN(g) ? 0 : g, isNaN(b) ? 0 : b)
  }

  const accentColor = hexToRgb(cfg.accent_color)
  const subtleGray = rgb(0.5, 0.5, 0.5)
  const darkText = rgb(0.1, 0.1, 0.1)
  const headerColor = hexToRgb(cfg.header_color)
  const headerTextColor = hexToRgb(cfg.header_text_color)
  const brandName = cfg.brand_name || "BRAND"

  // ── Image embed helper ─────────────────────────────────────────────────────
  async function embedUrl(url: string) {
    try {
      const res = await fetch(url)
      const buf = await res.arrayBuffer()
      const bytes = new Uint8Array(buf)
      const mime = res.headers.get("content-type") ?? ""
      if (mime.includes("png") || url.toLowerCase().endsWith(".png")) {
        return await pdfDoc.embedPng(bytes)
      }
      return await pdfDoc.embedJpg(bytes)
    } catch {
      return null
    }
  }

  // ── Draw canvas elements on a page ────────────────────────────────────────
  async function drawCanvasEls(page: any, elements: CanvasEl[]) {
    for (const el of elements) {
      const op = el.opacity ?? 1
      const elColor = hexToRgb(el.color ?? "#111111")
      const elFill = hexToRgb(el.fill ?? "#eeeeee")

      // Convert mm coords: pdf-lib y=0 is bottom, so flip y
      const px = mm(el.x)
      const py = H - mm(el.y)

      switch (el.type) {
        case "text": {
          const fontSize = el.fontSize ?? 8
          const font = el.bold ? fontBold : el.italic ? fontOblique : fontRegular
          const safeText = (el.text ?? "").replace(/[^\x20-\x7E]/g, "?")
          if (!safeText) break
          const textW = font.widthOfTextAtSize(safeText, fontSize)
          page.drawText(safeText, {
            x: px,
            y: py - fontSize * 0.352778,
            size: fontSize,
            font,
            color: elColor,
            opacity: op,
            maxWidth: W - px,
          })
          break
        }
        case "rect": {
          page.drawRectangle({
            x: px,
            y: py - mm(el.h),
            width: mm(el.w),
            height: mm(el.h),
            color: el.fill && el.fill !== "none" ? elFill : undefined,
            borderColor: el.color && el.color !== "none" ? elColor : undefined,
            borderWidth: mm(el.strokeWidth ?? 0),
            opacity: op,
          })
          break
        }
        case "circle": {
          const r = mm(el.r ?? 5)
          page.drawCircle({
            x: px,
            y: py,
            size: r,
            color: el.fill && el.fill !== "none" ? elFill : undefined,
            borderColor: el.color && el.color !== "none" ? elColor : undefined,
            borderWidth: mm(el.strokeWidth ?? 0),
            opacity: op,
          })
          break
        }
        case "image": {
          if (!el.url) break
          const img = await embedUrl(el.url)
          if (!img) break
          page.drawImage(img, {
            x: px,
            y: py - mm(el.h),
            width: mm(el.w),
            height: mm(el.h),
            opacity: op,
          })
          break
        }
      }
    }
  }

  // ── Compute layout (respects user position overrides) ──────────────────────
  const frontL = computeFrontLayout(cfg)
  const backL = computeBackLayout(cfg)

  // Helper: convert mm layout (y from top) to pdf-lib y (from bottom) for bottom edge of rect
  const pdfY = (yMm: number, hMm = 0) => H - mm(yMm + hMm)

  // ── PAGE 1: FRONT ──────────────────────────────────────────────────────────

  const front = pdfDoc.addPage([W, H])
  front.drawRectangle({ x: 0, y: 0, width: W, height: H, color: rgb(1, 1, 1) })

  const FL_BAND = frontL["band"]
  const FL_HOLE = frontL["punch-hole"]
  const FL_TAGLINE = frontL["tagline"]
  const FL_DIVIDER = frontL["divider"]
  const FL_TITLE = frontL["title"]
  const FL_BADGE = frontL["status-badge"]

  const HOLE_R = mm(FL_HOLE.r ?? 2.2)
  const HOLE_CY = H - mm(FL_HOLE.y)

  const BAND_H = mm(FL_BAND.h)
  const BAND_BOTTOM = pdfY(FL_BAND.y, FL_BAND.h)

  // Brand band
  front.drawRectangle({ x: mm(FL_BAND.x), y: BAND_BOTTOM, width: mm(FL_BAND.w), height: BAND_H, color: headerColor })

  // Logo or brand name in band
  if (cfg.logo_url) {
    const logoImg = await embedUrl(cfg.logo_url)
    if (logoImg) {
      const logoPad = BAND_H * 0.1
      front.drawImage(logoImg, {
        x: MARGIN + logoPad,
        y: BAND_BOTTOM + logoPad,
        width: W - MARGIN * 2 - logoPad * 2,
        height: BAND_H - logoPad * 2,
      })
    }
  } else {
    const brandFontSize = Math.min(12, BAND_H * 0.38)
    const brandTextW = fontBold.widthOfTextAtSize(brandName, brandFontSize)
    front.drawText(brandName, {
      x: (W - brandTextW) / 2,
      y: BAND_BOTTOM + (BAND_H - brandFontSize) / 2 + 1,
      size: brandFontSize,
      font: fontBold,
      color: headerTextColor,
    })
  }

  // Punch hole (drawn after band so it appears on top)
  if (cfg.show_punch_hole) {
    front.drawCircle({ x: mm(FL_HOLE.x), y: HOLE_CY, size: HOLE_R + mm(0.8), color: headerColor })
    front.drawCircle({ x: mm(FL_HOLE.x), y: HOLE_CY, size: HOLE_R, color: rgb(0.88, 0.88, 0.88) })
    front.drawCircle({ x: mm(FL_HOLE.x), y: HOLE_CY, size: HOLE_R, borderColor: rgb(0.6, 0.6, 0.6), borderWidth: 0.5 })
  }

  // Product title below band
  let fy = H - mm(FL_TITLE.y) - mm(4)
  const titleFontSize = 9
  const titleLines = wrapText(product.title ?? "Untitled", fontBold, titleFontSize, INNER_W)
  for (const line of titleLines.slice(0, 2)) {
    const lineW = fontBold.widthOfTextAtSize(line, titleFontSize)
    front.drawText(line, { x: (W - lineW) / 2, y: fy, size: titleFontSize, font: fontBold, color: rgb(0.05, 0.05, 0.05) })
    fy -= 12
  }

  // Status badge (centered)
  if (cfg.show_status_badge && product.status) {
    const statusLabel = product.status.charAt(0).toUpperCase() + product.status.slice(1)
    const sSize = 6.5
    const sW = fontRegular.widthOfTextAtSize(statusLabel, sSize) + mm(3)
    const sH = mm(FL_BADGE.h)
    const sX = mm(FL_BADGE.x)
    front.drawRectangle({ x: sX, y: pdfY(FL_BADGE.y, FL_BADGE.h), width: mm(FL_BADGE.w), height: sH, color: accentColor })
    front.drawText(statusLabel, { x: sX + mm(1.5), y: pdfY(FL_BADGE.y, FL_BADGE.h) + mm(0.5), size: sSize, font: fontRegular, color: rgb(0.3, 0.3, 0.3) })
  }

  // Accent divider line
  front.drawLine({
    start: { x: mm(FL_DIVIDER.x), y: pdfY(FL_DIVIDER.y) },
    end:   { x: mm(FL_DIVIDER.x + FL_DIVIDER.w), y: pdfY(FL_DIVIDER.y) },
    thickness: 0.5,
    color: accentColor,
  })

  // Tagline near bottom (centered)
  if (cfg.show_tagline && cfg.tagline) {
    const taglineSize = 6.5
    const taglineY = pdfY(FL_TAGLINE.y)
    const taglineW = fontOblique.widthOfTextAtSize(cfg.tagline, taglineSize)
    if (taglineW <= INNER_W) {
      front.drawText(cfg.tagline, {
        x: (W - taglineW) / 2,
        y: taglineY,
        size: taglineSize,
        font: fontOblique,
        color: rgb(0.6, 0.6, 0.6),
      })
    } else {
      const words = cfg.tagline.split(" ")
      const mid = Math.ceil(words.length / 2)
      const lines = [words.slice(0, mid).join(" "), words.slice(mid).join(" ")].filter(Boolean)
      let tY = taglineY + (lines.length - 1) * 8
      for (const line of lines) {
        const lW = fontOblique.widthOfTextAtSize(line, taglineSize)
        front.drawText(line, { x: (W - lW) / 2, y: tY, size: taglineSize, font: fontOblique, color: rgb(0.6, 0.6, 0.6) })
        tY -= 8
      }
    }
  }

  // ── Front canvas elements ───────────────────────────────────────────────────
  if (cfg.front_canvas?.length) {
    await drawCanvasEls(front, cfg.front_canvas)
  }

  // ── PAGE 2: BACK ───────────────────────────────────────────────────────────

  const back = pdfDoc.addPage([W, H])
  back.drawRectangle({ x: 0, y: 0, width: W, height: H, color: rgb(1, 1, 1) })

  const BL_STRIP = backL["strip"]
  const BL_HOLE = backL["punch-hole"]
  const BL_QR = backL["qr-code"]
  const BL_DIVIDER = backL["divider"]
  const BL_TAGLINE = backL["tagline"]
  const BL_SCAN = backL["scan-label"]

  const STRIP_H = mm(BL_STRIP.h)
  // Brand strip at top
  back.drawRectangle({ x: 0, y: H - STRIP_H, width: W, height: STRIP_H, color: headerColor })

  // Brand name left-aligned in strip
  const smallBrandSize = 7
  back.drawText(brandName, {
    x: MARGIN,
    y: H - STRIP_H + (STRIP_H - smallBrandSize) / 2 + 0.5,
    size: smallBrandSize,
    font: fontBold,
    color: headerTextColor,
  })
  // Decorative line to the right of brand name
  const bNameW = fontBold.widthOfTextAtSize(brandName, smallBrandSize)
  back.drawLine({
    start: { x: MARGIN + bNameW + mm(2), y: H - STRIP_H / 2 },
    end: { x: W - MARGIN, y: H - STRIP_H / 2 },
    thickness: 0.4,
    color: headerTextColor,
    opacity: 0.35,
  })

  // Punch hole
  if (cfg.show_punch_hole) {
    const bHoleCY = H - mm(BL_HOLE.y)
    back.drawCircle({ x: mm(BL_HOLE.x), y: bHoleCY, size: HOLE_R + mm(0.8), color: headerColor })
    back.drawCircle({ x: mm(BL_HOLE.x), y: bHoleCY, size: HOLE_R, color: rgb(0.88, 0.88, 0.88) })
    back.drawCircle({ x: mm(BL_HOLE.x), y: bHoleCY, size: HOLE_R, borderColor: rgb(0.6, 0.6, 0.6), borderWidth: 0.5 })
  }

  // Content: starts just below strip
  let by = H - STRIP_H - mm(6)

  const designs = product.designs ?? []

  if (cfg.show_design_info && designs.length > 0) {
    const d = designs[0]

    back.drawText("DESIGN", { x: MARGIN, y: by, size: 5.5, font: fontBold, color: rgb(0.6, 0.6, 0.6) })
    by -= mm(3)

    const dName = truncate(d.name ?? "", fontBold, 8, INNER_W)
    back.drawText(dName, { x: MARGIN, y: by, size: 8, font: fontBold, color: darkText })
    by -= 10

    if (d.design_type) {
      back.drawText(d.design_type.replace(/_/g, " "), { x: MARGIN, y: by, size: 6.5, font: fontOblique, color: rgb(0.45, 0.45, 0.45) })
      by -= 9
    }

    if (cfg.show_partner_info) {
      const partners = d.partners ?? []
      if (partners.length > 0) {
        by -= mm(1)
        back.drawText("MADE BY", { x: MARGIN, y: by, size: 5.5, font: fontBold, color: rgb(0.6, 0.6, 0.6) })
        by -= mm(3)
        for (const p of partners.slice(0, 2)) {
          back.drawText(truncate(p.name ?? "", fontRegular, 7.5, INNER_W), { x: MARGIN, y: by, size: 7.5, font: fontRegular, color: darkText })
          by -= 9
          for (const person of (p.people ?? []).slice(0, 2)) {
            const name = [person.first_name, person.last_name].filter(Boolean).join(" ")
            if (name) {
              back.drawText(truncate(`> ${name}`, fontRegular, 6.5, INNER_W - mm(2)), { x: MARGIN + mm(2), y: by, size: 6.5, font: fontRegular, color: rgb(0.4, 0.4, 0.4) })
              by -= 8
            }
          }
        }
      }
    }

    if (cfg.show_color_palette) {
      const palette = d.color_palette ?? []
      if (palette.length > 0) {
        by -= mm(1.5)
        const DOT = mm(2.4)
        let cx = MARGIN
        for (const c of palette.slice(0, 8)) {
          const dotColor = hexToRgb(c.code ?? c.value ?? "#cccccc")
          back.drawCircle({ x: cx + DOT / 2, y: by - DOT / 2, size: DOT / 2, color: dotColor })
          back.drawCircle({ x: cx + DOT / 2, y: by - DOT / 2, size: DOT / 2, borderColor: rgb(0.7, 0.7, 0.7), borderWidth: 0.3 })
          cx += DOT + mm(0.9)
        }
        by -= DOT + mm(2)
      }
    }

    if (cfg.show_design_tags) {
      const dTags = Array.isArray(d.tags) ? d.tags : []
      if (dTags.length > 0) {
        back.drawText(truncate(dTags.slice(0, 4).join("  .  "), fontOblique, 6, INNER_W), { x: MARGIN, y: by, size: 6, font: fontOblique, color: subtleGray })
        by -= 8
      }
    }

    by -= mm(1)
  }

  const directPeople = (product.people ?? []).slice(0, 2)
  if (cfg.show_collaborators && directPeople.length > 0) {
    back.drawText("COLLABORATORS", { x: MARGIN, y: by, size: 5.5, font: fontBold, color: rgb(0.6, 0.6, 0.6) })
    by -= mm(3)
    for (const person of directPeople) {
      const name = [person.first_name, person.last_name].filter(Boolean).join(" ")
      if (name) {
        back.drawText(truncate(name, fontRegular, 7, INNER_W), { x: MARGIN, y: by, size: 7, font: fontRegular, color: rgb(0.2, 0.2, 0.2) })
        by -= 9
      }
    }
    by -= mm(1)
  }

  // Divider above QR area
  back.drawLine({
    start: { x: mm(BL_DIVIDER.x), y: pdfY(BL_DIVIDER.y) },
    end:   { x: mm(BL_DIVIDER.x + BL_DIVIDER.w), y: pdfY(BL_DIVIDER.y) },
    thickness: 0.4,
    color: accentColor,
  })

  if (cfg.show_qr_code) {
    const QR_SIZE = mm(BL_QR.w)
    const QR_Y = pdfY(BL_QR.y, BL_QR.h)
    const qrDataUrl: string = await toDataURL(product.storefront_url, {
      width: 200, margin: 1, color: { dark: cfg.header_color, light: "#ffffff" },
    })
    const qrBase64 = qrDataUrl.split(",")[1]
    const qrImageBytes = Uint8Array.from(atob(qrBase64), (c) => c.charCodeAt(0))
    const qrImage = await pdfDoc.embedPng(qrImageBytes)

    back.drawImage(qrImage, { x: mm(BL_QR.x), y: QR_Y, width: QR_SIZE, height: QR_SIZE })

    // Scan label above QR
    const scanLabel = cfg.scan_label || "scan me"
    const scanSize = 5.5
    const scanW = fontOblique.widthOfTextAtSize(scanLabel, scanSize)
    back.drawText(scanLabel, { x: (W - scanW) / 2, y: pdfY(BL_SCAN.y), size: scanSize, font: fontOblique, color: subtleGray })

    // Handle below QR
    const handleStr = `/${product.handle}`
    const handleSize = 5
    const handleW = fontRegular.widthOfTextAtSize(handleStr, handleSize)
    back.drawText(handleStr, { x: (W - handleW) / 2, y: QR_Y - mm(3), size: handleSize, font: fontOblique, color: subtleGray })
  }

  // Tagline at very bottom
  if (cfg.show_tagline && cfg.tagline) {
    const taglineSize = 6
    const taglineW = fontOblique.widthOfTextAtSize(cfg.tagline, taglineSize)
    if (taglineW <= INNER_W) {
      back.drawText(cfg.tagline, { x: (W - taglineW) / 2, y: pdfY(BL_TAGLINE.y), size: taglineSize, font: fontOblique, color: rgb(0.6, 0.6, 0.6) })
    }
  }

  // ── Back canvas elements ────────────────────────────────────────────────────
  if (cfg.back_canvas?.length) {
    await drawCanvasEls(back, cfg.back_canvas)
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
  const { config: hangTagConfig } = useHangTagSettings()

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
        const pdfBytes = await generateHangTagPdf(result.value, hangTagConfig)
        const blob = new Blob([pdfBytes as BlobPart], { type: "application/pdf" })
        const url = URL.createObjectURL(blob)
        window.open(url, "_blank")
        toast.success("Hang tag opened for printing (2 pages: front + back)")
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
            const pdfBytes = await generateHangTagPdf(result.value, hangTagConfig)
            const tagDoc = await PDFDocument.load(pdfBytes)
            const [frontPage, backPage] = await mergedDoc.copyPages(tagDoc, [0, 1])
            mergedDoc.addPage(frontPage)
            mergedDoc.addPage(backPage)
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
