import { generateEntityId, MedusaError, MedusaService } from "@medusajs/framework/utils"
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
  // White-label (#2541): logo, the maker story, care text and a blank MRP line
  logo_url?: string
  show_story?: boolean
  show_care?: boolean
  care_text?: string
  show_mrp?: boolean
  /** Print the brand name under a logo that has no wordmark */
  show_brand_name?: boolean
  mrp_label?: string
  mrp_note?: string
}

/**
 * A white-label brand (#2541): a partner or buyer whose name and logo go on
 * the tag instead of ours. Stored as a `hang_tag_settings` row keyed
 * `brand:<id>`; its config is laid over the default config at print time, so
 * a profile only holds what it changes.
 */
export type HangTagBrand = {
  id: string
  config: Partial<HangTagConfig>
  created_at?: Date | string
  updated_at?: Date | string
}

const DEFAULT_KEY = "default"
const BRAND_PREFIX = "brand:"

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
  // Off by default so existing prints keep their layout; brand profiles turn them on.
  show_story: false,
  show_care: false,
  show_mrp: false,
  mrp_label: "MRP",
  mrp_note: "Inclusive of all taxes",
}

/** What a new brand profile starts with: the white-label sections on. */
export const NEW_BRAND_DEFAULTS: Partial<HangTagConfig> = {
  show_story: true,
  show_care: true,
  show_mrp: true,
  show_brand_name: true,
  // Our own sections stay off on someone else's tag: the design name is an
  // internal label, and the QR opens OUR storefront.
  show_status_badge: false,
  show_design_info: false,
  show_partner_info: false,
  show_color_palette: false,
  show_design_tags: false,
  show_collaborators: false,
  show_qr_code: false,
  header_color: "#ffffff",
  header_text_color: "#111111",
  tagline: "Made by hand in India",
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

  // ── Brand profiles (#2541) ────────────────────────────────────────────────

  private toBrand(row: any): HangTagBrand {
    return {
      id: String(row.key).slice(BRAND_PREFIX.length),
      config: row.config ?? {},
      created_at: row.created_at,
      updated_at: row.updated_at,
    }
  }

  private async brandRow(id: string): Promise<any> {
    const [row] = await this.listHangTagSettings({ key: `${BRAND_PREFIX}${id}` } as any)
    if (!row) {
      throw new MedusaError(MedusaError.Types.NOT_FOUND, `Hang tag brand "${id}" not found`)
    }
    return row
  }

  async listBrands(): Promise<HangTagBrand[]> {
    const rows = await this.listHangTagSettings(
      { key: { $like: `${BRAND_PREFIX}%` } } as any,
      { order: { created_at: "ASC" } } as any
    )
    return (rows || []).map((r) => this.toBrand(r))
  }

  async getBrand(id: string): Promise<HangTagBrand> {
    return this.toBrand(await this.brandRow(id))
  }

  async createBrand(config: Partial<HangTagConfig>): Promise<HangTagBrand> {
    const id = generateEntityId(undefined, "htbrand")
    const row = await this.createHangTagSettings({
      key: `${BRAND_PREFIX}${id}`,
      config: { ...NEW_BRAND_DEFAULTS, ...config },
    } as any)
    return this.toBrand(row)
  }

  async updateBrand(id: string, config: Partial<HangTagConfig>): Promise<HangTagBrand> {
    const row = await this.brandRow(id)
    const updated = await this.updateHangTagSettings({
      id: row.id,
      config: { ...(row.config ?? {}), ...config },
    } as any)
    return this.toBrand(updated)
  }

  async deleteBrand(id: string): Promise<void> {
    const row = await this.brandRow(id)
    await this.deleteHangTagSettings(row.id)
  }
}

export default HangTagSettingsService
