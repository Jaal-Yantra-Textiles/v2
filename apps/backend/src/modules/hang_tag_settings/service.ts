import { MedusaService } from "@medusajs/framework/utils"
import HangTagSettings from "./models/hang-tag-settings"

export type HangTagConfig = {
  // Dimensions
  width_mm: number
  height_mm: number
  // Branding
  brand_name: string
  header_color: string
  header_text_color: string
  accent_color: string
  // Text
  tagline: string
  scan_label: string
  // Section visibility
  show_status_badge: boolean
  show_design_info: boolean
  show_partner_info: boolean
  show_color_palette: boolean
  show_design_tags: boolean
  show_collaborators: boolean
  show_qr_code: boolean
  show_tagline: boolean
  show_punch_hole: boolean
  // QR tracking parameters
  qr_params?: Array<{ key: string; value: string }>
}

const DEFAULT_KEY = "default"

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

class HangTagSettingsService extends MedusaService({ HangTagSettings }) {
  async getOrCreate(): Promise<{ id: string; key: string; config: HangTagConfig }> {
    const existing = await this.listHangTagSettings({ key: DEFAULT_KEY } as any)
    const current = (existing || [])[0] as any
    if (current) return current

    const created = await this.createHangTagSettings({
      key: DEFAULT_KEY,
      config: DEFAULT_HANG_TAG_CONFIG,
    } as any)
    return created as any
  }

  async getConfig(): Promise<HangTagConfig> {
    const settings = await this.getOrCreate()
    return { ...DEFAULT_HANG_TAG_CONFIG, ...(settings.config ?? {}) } as HangTagConfig
  }

  async updateConfig(config: Partial<HangTagConfig>): Promise<{ id: string; key: string; config: HangTagConfig }> {
    const settings = await this.getOrCreate()
    const merged: HangTagConfig = { ...DEFAULT_HANG_TAG_CONFIG, ...(settings.config ?? {}), ...config }
    const updated = await this.updateHangTagSettings({ id: settings.id, config: merged } as any)
    return updated as any
  }
}

export default HangTagSettingsService
