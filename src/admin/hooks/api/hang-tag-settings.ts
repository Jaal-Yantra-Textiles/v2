import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { sdk } from "../../lib/config"
import { queryKeysFactory } from "../../lib/query-key-factory"

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
