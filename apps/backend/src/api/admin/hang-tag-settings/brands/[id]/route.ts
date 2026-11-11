import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { HANG_TAG_SETTINGS_MODULE } from "../../../../../modules/hang_tag_settings"
import type HangTagSettingsService from "../../../../../modules/hang_tag_settings/service"
import type { UpdateHangTagBrand } from "../../validators"

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const service: HangTagSettingsService = req.scope.resolve(HANG_TAG_SETTINGS_MODULE)
  const brand = await service.getBrand(req.params.id)
  res.json({ brand })
}

/** PUT merges: fields left out keep their saved value. */
export const PUT = async (req: MedusaRequest<UpdateHangTagBrand>, res: MedusaResponse) => {
  const service: HangTagSettingsService = req.scope.resolve(HANG_TAG_SETTINGS_MODULE)
  const brand = await service.updateBrand(req.params.id, req.validatedBody.config as any)
  res.json({ brand })
}

export const DELETE = async (req: MedusaRequest, res: MedusaResponse) => {
  const service: HangTagSettingsService = req.scope.resolve(HANG_TAG_SETTINGS_MODULE)
  await service.deleteBrand(req.params.id)
  res.json({ id: req.params.id, object: "hang_tag_brand", deleted: true })
}
