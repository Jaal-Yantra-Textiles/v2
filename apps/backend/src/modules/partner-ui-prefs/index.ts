import { Module } from "@medusajs/framework/utils"
import PartnerUiPrefsService from "./service"

export const PARTNER_UI_PREFS_MODULE = "partner_ui_prefs"

export default Module(PARTNER_UI_PREFS_MODULE, {
  service: PartnerUiPrefsService,
})
