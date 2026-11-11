import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { sdk } from "../../lib/config"
import { queryKeysFactory } from "../../lib/query-key-factory"

// ── Canvas element types ───────────────────────────────────────────────────────

export type CanvasElType = "text" | "rect" | "circle" | "image"

export type CanvasEl = {
  id: string
  type: CanvasElType
  // Position and size in mm from tag's top-left corner
  x: number
  y: number
  w: number   // mm — width (rect/image); unused for circle/text
  h: number   // mm — height (rect/image); line-height for text
  r?: number  // mm — radius for circle
  // Text
  text?: string
  fontSize?: number   // pt
  bold?: boolean
  italic?: boolean
  // Appearance
  color?: string   // hex — text color / stroke color for shapes
  fill?: string    // hex — fill for rect/circle (use "none" for transparent)
  strokeWidth?: number
  opacity?: number // 0–1
  // Image
  url?: string
}

export function makeEl(type: CanvasElType, x: number, y: number): CanvasEl {
  const id = `${type}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
  switch (type) {
    case "text":   return { id, type, x, y, w: 30, h: 5, text: "Text", fontSize: 8, bold: false, italic: false, color: "#111111", opacity: 1 }
    case "rect":   return { id, type, x, y, w: 20, h: 10, fill: "#eeeeee", color: "#cccccc", strokeWidth: 0.5, opacity: 1 }
    case "circle": return { id, type, x, y, w: 10, h: 10, r: 5, fill: "#eeeeee", color: "#cccccc", strokeWidth: 0.5, opacity: 1 }
    case "image":  return { id, type, x, y, w: 20, h: 20, url: "", opacity: 1 }
  }
}

// ── Main config type ───────────────────────────────────────────────────────────

// ── Layout position override ───────────────────────────────────────────────────

export type LayoutPos = {
  x?: number   // mm
  y?: number   // mm
  w?: number   // mm
  h?: number   // mm
  r?: number   // mm (circle radius)
}

export type HangTagConfig = {
  width_mm: number
  height_mm: number
  brand_name: string
  header_color: string
  header_text_color: string
  accent_color: string
  tagline: string
  scan_label: string
  show_status_badge: boolean
  show_design_info: boolean
  show_partner_info: boolean
  show_color_palette: boolean
  show_design_tags: boolean
  show_collaborators: boolean
  show_qr_code: boolean
  show_tagline: boolean
  show_punch_hole: boolean
  // Logo
  logo_url?: string
  // QR tracking parameters appended to QR code URLs
  qr_params?: Array<{ key: string; value: string }>
  // Free-form canvas layers (per side)
  front_canvas?: CanvasEl[]
  back_canvas?: CanvasEl[]
  // Template element position overrides (per side)
  front_layout?: Record<string, LayoutPos>
  back_layout?: Record<string, LayoutPos>
  // White-label (#2541): the maker story, care text and a blank MRP line
  show_story?: boolean
  show_care?: boolean
  care_text?: string
  show_mrp?: boolean
  /** Print the brand name under a logo that has no wordmark */
  show_brand_name?: boolean
  mrp_label?: string
  mrp_note?: string
}

export const DEFAULT_HANG_TAG_CONFIG: HangTagConfig = {
  width_mm: 55,
  height_mm: 90,
  brand_name: "JYT",
  header_color: "#111111",
  header_text_color: "#ffffff",
  accent_color: "#eeeeee",
  tagline: "Handcrafted with care",
  scan_label: "scan me",
  show_status_badge: true,
  show_design_info: true,
  show_partner_info: true,
  show_color_palette: true,
  show_design_tags: true,
  show_collaborators: true,
  show_qr_code: true,
  show_tagline: true,
  show_punch_hole: true,
  logo_url: undefined,
  qr_params: [],
  front_canvas: [],
  back_canvas: [],
  front_layout: {},
  back_layout: {},
  show_story: false,
  show_care: false,
  care_text: "",
  show_mrp: false,
  mrp_label: "MRP",
  mrp_note: "Inclusive of all taxes",
}

/** The care text a tag prints when its config sets none. */
export const DEFAULT_CARE_TEXT =
  "Handwoven fabric, coloured with vegetable dyes, so each piece is a little different and colours may soften with time. Hand wash gently in cold water, separately, with a mild soap. Do not wring or bleach. Dry in the shade."

// ── Layout computation helpers ─────────────────────────────────────────────────

export function computeFrontLayout(
  cfg: HangTagConfig
): Record<string, { x: number; y: number; w: number; h: number; r?: number }> {
  const W = cfg.width_mm, H = cfg.height_mm
  const HOLE_R = 2.2, HOLE_CY = HOLE_R + 2.5
  const BAND_Y = HOLE_CY + HOLE_R + 4
  const BAND_H = H * 0.26
  // A wordmark-less logo gets the brand name under it (#2541); the title moves down.
  const BRAND_NAME_Y = BAND_Y + BAND_H + 2
  const hasBrandName = !!(cfg.logo_url && cfg.show_brand_name)
  const TITLE_Y = BAND_Y + BAND_H + 3.5 + (hasBrandName ? 5 : 0)
  const BADGE_Y = TITLE_Y + 3.5
  const ov = cfg.front_layout ?? {}

  const defaults: Record<string, { x: number; y: number; w: number; h: number; r?: number }> = {
    "band":         { x: 0,           y: BAND_Y,              w: W,        h: BAND_H },
    "punch-hole":   { x: W / 2,       y: HOLE_CY,             w: HOLE_R*2, h: HOLE_R*2, r: HOLE_R },
    "logo":         { x: 4,           y: BAND_Y + BAND_H*0.1, w: W-8,      h: BAND_H*0.8 },
    "title":        { x: W / 2,       y: TITLE_Y,             w: W-8,      h: 4 },
    "status-badge": { x: (W-12.7)/2,  y: BADGE_Y,             w: 12.7,     h: 3.2 },
    "divider":      { x: W*0.2,       y: H*0.72,              w: W*0.6,    h: 0 },
    "tagline":      { x: W / 2,       y: H - 2,               w: W-8,      h: 2.5 },
    "brand-name":   { x: W / 2,       y: BRAND_NAME_Y,        w: W-8,      h: 3.5 },
  }
  return Object.fromEntries(
    Object.entries(defaults).map(([id, def]) => [id, { ...def, ...(ov[id] ?? {}) }])
  )
}

export function computeBackLayout(
  cfg: HangTagConfig
): Record<string, { x: number; y: number; w: number; h: number; r?: number }> {
  const W = cfg.width_mm, H = cfg.height_mm
  const STRIP_H = 7, HOLE_R = 2.2, HOLE_CY = HOLE_R + 2.5
  const QR_SIZE = 15, QR_BOTTOM = 5
  const QR_Y = H - QR_BOTTOM - QR_SIZE
  const DIV_Y = QR_Y - 4
  let y = STRIP_H + 3
  const ov = cfg.back_layout ?? {}

  const computedDesignY = y; y += cfg.show_design_info ? 15 : 0
  const computedPartnerY = y + (cfg.show_partner_info ? 1 : 0); y += cfg.show_partner_info ? 12 : 0
  const computedPaletteY = y + 1; y += cfg.show_color_palette ? 9 : 0
  const computedTagsY = y; y += cfg.show_design_tags ? 5 : 0
  const computedCollabY = y + 1
  y = computedCollabY + (cfg.show_collaborators ? 10 : 0)

  // White-label boxes (#2541): story, fabric and care share the room between
  // the sections above and the MRP line, which sits above the QR when there
  // is one, else at the foot. Text that overflows a box is cut, so a box can
  // be dragged and resized in the editor and the print follows it.
  const bottom = cfg.show_qr_code ? DIV_Y - 1 : H - (cfg.show_tagline && cfg.tagline ? 4 : 1.5)
  const MRP_H = 7
  const mrpY = bottom - MRP_H
  const flowEnd = (cfg.show_mrp ? mrpY : bottom) - 1.5
  const room = Math.max(flowEnd - y, 0)
  const FABRIC_H = 7
  const storyH = cfg.show_story ? Math.max(room * (cfg.show_care ? 0.5 : 1) - (FABRIC_H + 1), 8) : 0
  const storyY = y
  const fabricY = storyY + storyH + (cfg.show_story ? 1 : 0)
  const careY = fabricY + (cfg.show_story ? FABRIC_H + 1 : 0)
  const careH = Math.max(flowEnd - careY, 8)

  const defaults: Record<string, { x: number; y: number; w: number; h: number; r?: number }> = {
    "strip":         { x: 0,                y: 0,                w: W,       h: STRIP_H },
    "brand-text":    { x: 4,                y: STRIP_H/2 - 1,   w: W-8,     h: 3 },
    "punch-hole":    { x: W/2,              y: HOLE_CY,          w: HOLE_R*2, h: HOLE_R*2, r: HOLE_R },
    "design-info":   { x: 4,                y: computedDesignY,  w: W-8,     h: 12 },
    "partner-info":  { x: 4,                y: computedPartnerY, w: W-8,     h: 8 },
    "palette":       { x: 4,                y: computedPaletteY, w: W-8,     h: 6 },
    "design-tags":   { x: 4,                y: computedTagsY,    w: W-8,     h: 4 },
    "collaborators": { x: 4,                y: computedCollabY,  w: W-8,     h: 8 },
    "divider":       { x: 4,                y: DIV_Y,            w: W-8,     h: 0 },
    "qr-code":       { x: W/2 - QR_SIZE/2,  y: QR_Y,             w: QR_SIZE, h: QR_SIZE },
    "scan-label":    { x: W/2,              y: QR_Y - 2.5,       w: W-8,     h: 2.5 },
    "tagline":       { x: W/2,              y: H - 0.5,          w: W-8,     h: 2.5 },
    "story":         { x: 4,                y: storyY,           w: W-8,     h: storyH },
    "fabric":        { x: 4,                y: fabricY,          w: W-8,     h: FABRIC_H },
    "care":          { x: 4,                y: careY,            w: W-8,     h: careH },
    "mrp":           { x: 4,                y: mrpY,             w: W-8,     h: MRP_H },
  }
  return Object.fromEntries(
    Object.entries(defaults).map(([id, def]) => [id, { ...def, ...(ov[id] ?? {}) }])
  )
}

const HANG_TAG_QUERY_KEY = "hang_tag_settings" as const
export const hangTagSettingsQueryKeys = queryKeysFactory(HANG_TAG_QUERY_KEY)

export const useHangTagSettings = () => {
  const { data, ...rest } = useQuery({
    queryKey: hangTagSettingsQueryKeys.detail("default"),
    queryFn: async () =>
      sdk.client.fetch<{ config: HangTagConfig }>("/admin/hang-tag-settings"),
  })
  return { ...rest, config: data?.config ?? DEFAULT_HANG_TAG_CONFIG }
}

export const useUpdateHangTagSettings = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (config: Partial<HangTagConfig>) =>
      sdk.client.fetch<{ config: HangTagConfig }>("/admin/hang-tag-settings", {
        method: "PUT",
        body: config,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: hangTagSettingsQueryKeys.detail("default"),
      })
    },
  })
}

// ── White-label brand profiles (#2541) ────────────────────────────────────────

/** A partner or buyer whose name and logo go on the tag instead of ours. */
export type HangTagBrand = {
  id: string
  /** Only what the brand changes; laid over the default config at print time. */
  config: Partial<HangTagConfig>
  created_at?: string
  updated_at?: string
}

/** The config a tag is printed with: our default, overridden by the brand. */
export const resolveBrandConfig = (
  base: HangTagConfig,
  brand?: HangTagBrand | null
): HangTagConfig => (brand ? { ...base, ...brand.config } : base)

export const useHangTagBrands = () => {
  const { data, ...rest } = useQuery({
    queryKey: hangTagSettingsQueryKeys.list({ kind: "brands" }),
    queryFn: async () =>
      sdk.client.fetch<{ brands: HangTagBrand[]; count: number }>(
        "/admin/hang-tag-settings/brands"
      ),
  })
  return { ...rest, brands: data?.brands ?? [] }
}

const useInvalidateBrands = () => {
  const queryClient = useQueryClient()
  return () =>
    queryClient.invalidateQueries({
      queryKey: hangTagSettingsQueryKeys.list({ kind: "brands" }),
    })
}

export const useCreateHangTagBrand = () => {
  const invalidate = useInvalidateBrands()
  return useMutation({
    mutationFn: async (config: Partial<HangTagConfig>) =>
      sdk.client.fetch<{ brand: HangTagBrand }>("/admin/hang-tag-settings/brands", {
        method: "POST",
        body: { config },
      }),
    onSuccess: invalidate,
  })
}

export const useUpdateHangTagBrand = () => {
  const invalidate = useInvalidateBrands()
  return useMutation({
    mutationFn: async ({ id, config }: { id: string; config: Partial<HangTagConfig> }) =>
      sdk.client.fetch<{ brand: HangTagBrand }>(`/admin/hang-tag-settings/brands/${id}`, {
        method: "PUT",
        body: { config },
      }),
    onSuccess: invalidate,
  })
}

export const useDeleteHangTagBrand = () => {
  const invalidate = useInvalidateBrands()
  return useMutation({
    mutationFn: async (id: string) =>
      sdk.client.fetch(`/admin/hang-tag-settings/brands/${id}`, { method: "DELETE" }),
    onSuccess: invalidate,
  })
}
