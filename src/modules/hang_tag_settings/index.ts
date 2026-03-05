import { Module } from "@medusajs/framework/utils"
import HangTagSettingsService from "./service"

export const HANG_TAG_SETTINGS_MODULE = "hang_tag_settings"

const HangTagSettingsModule = Module(HANG_TAG_SETTINGS_MODULE, {
  service: HangTagSettingsService,
})

export { HangTagSettingsModule }
export default HangTagSettingsModule
