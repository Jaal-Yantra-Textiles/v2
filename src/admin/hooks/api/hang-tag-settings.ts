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
  // Free-form canvas layers (per side)
  front_canvas?: CanvasEl[]
  back_canvas?: CanvasEl[]
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
  front_canvas: [],
  back_canvas: [],
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
