import { sdk } from "../../lib/config"
import {
  CanvasEl,
  DEFAULT_CARE_TEXT,
  DEFAULT_HANG_TAG_CONFIG,
  HangTagConfig,
  computeBackLayout,
  computeFrontLayout,
} from "../../hooks/api/hang-tag-settings"

// ─── Hang Tag PDF generation (client-side, uses pdf-lib + qrcode) ─────────────

/** How it was made, from `GET /admin/products/:id/hang-tag` (#2541). */
export type HangTagStory = {
  design_id: string
  text: string
  makers: Array<{ id: string; name: string | null; lead: string | null; place: string | null; stage: string | null }>
  fabrics: Array<{ id: string; name: string | null; composition: string | null; color: string | null; technique: string | null }>
}

/**
 * Per-tag text, set in the review step before printing. Anything left
 * undefined falls back to what the records say.
 */
export type HangTagOverrides = {
  /** Under the title, e.g. "Linen, green · 70 × 200 cm" */
  variant_line?: string
  story_text?: string
  fabric_text?: string
  care_text?: string
}

export type HangTagData = {
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
    story?: HangTagStory | null
  }
}

export async function fetchHangTagData(productId: string): Promise<HangTagData> {
  return sdk.client.fetch<HangTagData>(`/admin/products/${productId}/hang-tag`)
}

// Points → mm helpers (1 pt = 0.352778 mm, 1 mm = 2.83465 pt)
const mm = (v: number) => v * 2.83465

/** Wrap text to lines that fit within maxWidth at a given font size */

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

/** Distinct fabric compositions, for the tag's default fabric line. */
export function defaultFabricText(story?: HangTagStory | null): string {
  const seen = new Set<string>()
  for (const f of story?.fabrics ?? []) {
    const label = f.composition || f.name
    if (label) seen.add(label)
  }
  return Array.from(seen).join(", ")
}

/**
 * pdf-lib's standard fonts encode WinAnsi only. Map the usual typography to
 * it and drop anything else, rather than letting one character fail the PDF.
 */
export function pdfSafe(text: string): string {
  return (text ?? "")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\u20B9/g, "Rs.")
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, "")
}

export async function generateHangTagPdf(
  data: HangTagData,
  cfg: HangTagConfig = DEFAULT_HANG_TAG_CONFIG,
  overrides: HangTagOverrides = {}
): Promise<Uint8Array> {
  const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib")
  const QRCode = await import("qrcode")

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
  // Routes the fetch through the server-side proxy so CORS on the source host
  // is never a problem. Falls back to a direct fetch for same-origin URLs.
  async function embedUrl(url: string) {
    const proxyUrl = `/admin/images/proxy?url=${encodeURIComponent(url)}`
    for (const target of [proxyUrl, url]) {
      try {
        const res = await fetch(target)
        if (!res.ok) continue
        const buf = await res.arrayBuffer()
        const bytes = new Uint8Array(buf)
        const mime = res.headers.get("content-type") ?? ""
        if (mime.includes("png") || url.toLowerCase().endsWith(".png")) {
          return await pdfDoc.embedPng(bytes)
        }
        if (mime.includes("jpeg") || mime.includes("jpg") || /\.(jpg|jpeg)$/i.test(url)) {
          return await pdfDoc.embedJpg(bytes)
        }
        // Unknown MIME — try PNG then JPEG
        try { return await pdfDoc.embedPng(bytes) } catch { /* fall through */ }
        return await pdfDoc.embedJpg(bytes)
      } catch { /* try next */ }
    }
    return null
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
      const maxW = W - MARGIN * 2 - logoPad * 2
      const maxH = BAND_H - logoPad * 2
      const dims = logoImg.scaleToFit(maxW, maxH)
      front.drawImage(logoImg, {
        x: (W - dims.width) / 2,
        y: BAND_BOTTOM + (BAND_H - dims.height) / 2,
        width: dims.width,
        height: dims.height,
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

  // A logo with no wordmark (#2541): print the brand name under it.
  // Its box is in the front layout; the title already sits below it.
  if (cfg.logo_url && cfg.show_brand_name && brandName) {
    const box = frontL["brand-name"]
    const bSize = 8
    const spaced = pdfSafe(brandName).toUpperCase().split("").join(" ")
    const bW = fontBold.widthOfTextAtSize(spaced, bSize)
    front.drawText(spaced, { x: mm(box.x) - bW / 2, y: pdfY(box.y, box.h), size: bSize, font: fontBold, color: rgb(0.1, 0.1, 0.1) })
  }
  const titleFontSize = 9
  const titleLines = wrapText(product.title ?? "Untitled", fontBold, titleFontSize, INNER_W)
  for (const line of titleLines.slice(0, 2)) {
    const lineW = fontBold.widthOfTextAtSize(line, titleFontSize)
    front.drawText(line, { x: (W - lineW) / 2, y: fy, size: titleFontSize, font: fontBold, color: rgb(0.05, 0.05, 0.05) })
    fy -= 12
  }

  // Variant line (#2541): colour / fabric / size of this piece
  const variantLine = pdfSafe(overrides.variant_line ?? "").trim()
  if (variantLine) {
    const vSize = 6.5
    for (const line of wrapText(variantLine, fontRegular, vSize, INNER_W).slice(0, 2)) {
      const lW = fontRegular.widthOfTextAtSize(line, vSize)
      front.drawText(line, { x: (W - lW) / 2, y: fy + 3, size: vSize, font: fontRegular, color: rgb(0.4, 0.4, 0.4) })
      fy -= 8.5
    }
  }

  // Status badge (centered)
  if (cfg.show_status_badge && product.status) {
    const statusLabel = product.status.charAt(0).toUpperCase() + product.status.slice(1)
    const sSize = 6.5
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

  // ── White-label sections (#2541): story, fabric, care, blank MRP ──────────
  // Each is drawn inside its layout box (computeBackLayout, draggable and
  // resizable in the editor); text that overflows a box is cut with "…".
  // An accent too light to read on white (the default #eeeeee) falls back to grey.
  const accentText = (() => {
    const h = (cfg.accent_color ?? "").replace("#", "")
    const lum = (0.299 * parseInt(h.slice(0, 2), 16) + 0.587 * parseInt(h.slice(2, 4), 16) + 0.114 * parseInt(h.slice(4, 6), 16)) / 255
    return isNaN(lum) || lum > 0.6 ? rgb(0.45, 0.45, 0.45) : accentColor
  })()

  const drawBox = (
    box: { x: number; y: number; w: number; h: number },
    label: string,
    text: string,
    size: number,
    font: any
  ) => {
    const body = pdfSafe(text).trim()
    if (!body || box.h <= 0) return
    const x = mm(box.x)
    const width = mm(box.w)
    const floor = pdfY(box.y, box.h)
    let ty = pdfY(box.y) - 5.5
    page2Text(label, x, ty, 5.5, fontBold, accentText)
    ty -= mm(3)
    const lineH = size * 1.32
    const lines = wrapText(body, font, size, width)
    for (let i = 0; i < lines.length; i++) {
      if (ty < floor) break
      const lastRoom = ty - lineH < floor && i < lines.length - 1
      const line = lastRoom ? truncate(`${lines[i]} ${lines[i + 1]}`, font, size, width - 4) : lines[i]
      page2Text(line, x, ty, size, font, darkText)
      ty -= lineH
      if (lastRoom) break
    }
  }
  function page2Text(t: string, x: number, y: number, size: number, font: any, color: any) {
    back.drawText(t, { x, y, size, font, color })
  }

  if (cfg.show_story) {
    drawBox(backL["story"], "THE STORY", overrides.story_text ?? product.story?.text ?? "", 6.5, fontOblique)
    drawBox(backL["fabric"], "FABRIC", overrides.fabric_text ?? defaultFabricText(product.story), 6, fontRegular)
  }
  if (cfg.show_care) {
    drawBox(backL["care"], "CARE", overrides.care_text ?? (cfg.care_text || DEFAULT_CARE_TEXT), 5.6, fontRegular)
  }
  if (cfg.show_mrp) {
    const box = backL["mrp"]
    const label = pdfSafe(cfg.mrp_label || "MRP")
    const lineY = pdfY(box.y + 4)
    back.drawText(label, { x: mm(box.x), y: lineY + 1, size: 8, font: fontBold, color: darkText })
    const lx = mm(box.x) + fontBold.widthOfTextAtSize(label, 8) + mm(1.5)
    back.drawLine({ start: { x: lx, y: lineY }, end: { x: mm(box.x + box.w), y: lineY }, thickness: 0.6, color: darkText })
    const note = pdfSafe(cfg.mrp_note ?? "")
    if (note) back.drawText(note, { x: mm(box.x), y: lineY - mm(2.6), size: 4.6, font: fontRegular, color: subtleGray })
  }

  // Divider above QR area
  if (cfg.show_qr_code) back.drawLine({
    start: { x: mm(BL_DIVIDER.x), y: pdfY(BL_DIVIDER.y) },
    end:   { x: mm(BL_DIVIDER.x + BL_DIVIDER.w), y: pdfY(BL_DIVIDER.y) },
    thickness: 0.4,
    color: accentColor,
  })

  if (cfg.show_qr_code) {
    const QR_SIZE = mm(BL_QR.w)
    const QR_Y = pdfY(BL_QR.y, BL_QR.h)
    // Use black for QR dark modules — header_color may be white/light making QR invisible
    const qrDarkColor = (() => {
      const h = (cfg.header_color ?? "#000000").replace("#", "")
      const r = parseInt(h.slice(0, 2), 16) || 0
      const g = parseInt(h.slice(2, 4), 16) || 0
      const b = parseInt(h.slice(4, 6), 16) || 0
      const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255
      return luminance > 0.5 ? "#000000" : cfg.header_color
    })()
    const qrCanvas = document.createElement("canvas")
    await (QRCode as any).toCanvas(qrCanvas, product.storefront_url, {
      width: 200, margin: 1, color: { dark: qrDarkColor, light: "#ffffff" },
    })
    const qrDataUrl = qrCanvas.toDataURL("image/png")
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
