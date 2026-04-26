import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { HANG_TAG_SETTINGS_MODULE } from "../../../modules/hang_tag_settings"
import type HangTagSettingsService from "../../../modules/hang_tag_settings/service"

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const service: HangTagSettingsService = req.scope.resolve(HANG_TAG_SETTINGS_MODULE)
  const config = await service.getConfig()
  return res.status(200).json({ config })
}

export const PUT = async (req: MedusaRequest, res: MedusaResponse) => {
  const service: HangTagSettingsService = req.scope.resolve(HANG_TAG_SETTINGS_MODULE)
  const body = (req as any).validatedBody ?? req.body ?? {}
  const updated = await service.updateConfig(body)
  return res.status(200).json({ config: updated.config })
}
