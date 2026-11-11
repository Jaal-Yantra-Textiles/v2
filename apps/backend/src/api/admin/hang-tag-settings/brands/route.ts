import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { HANG_TAG_SETTINGS_MODULE } from "../../../../modules/hang_tag_settings"
import type HangTagSettingsService from "../../../../modules/hang_tag_settings/service"
import type { CreateHangTagBrand } from "../validators"

/** GET /admin/hang-tag-settings/brands — white-label brand profiles (#2541). */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const service: HangTagSettingsService = req.scope.resolve(HANG_TAG_SETTINGS_MODULE)
  const brands = await service.listBrands()
  res.json({ brands, count: brands.length })
}

/** POST /admin/hang-tag-settings/brands — create a brand profile. */
export const POST = async (req: MedusaRequest<CreateHangTagBrand>, res: MedusaResponse) => {
  const service: HangTagSettingsService = req.scope.resolve(HANG_TAG_SETTINGS_MODULE)
  const brand = await service.createBrand(req.validatedBody.config as any)
  res.status(201).json({ brand })
}
