import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"

/**
 * The curated option vocabularies a partner can draw from — Colour and its
 * palette today, any future shared taxonomy for free.
 *
 * Each entry carries the hex so the picker and both storefronts can draw a
 * swatch without a second round trip.
 *
 * 🔑 A partner sees the curated values plus THEIR OWN additions, never another
 * partner's. The values all live on one shared row, so without this filter a
 * partner's private colour name would be listed for every competitor on the
 * platform. The `product_product_option_value` pivot already stops anyone
 * USING a value they did not select — this is about not showing it either.
 */
export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const partnerId = (req.auth_context as any)?.app_metadata?.partner_id
  const productService: any = req.scope.resolve(Modules.PRODUCT)

  const options = await productService.listProductOptions(
    { is_exclusive: false },
    { relations: ["values"] }
  )

  const palettes = (options ?? []).map((option: any) => ({
    id: option.id,
    title: option.title,
    values: (option.values ?? [])
      .filter((v: any) => {
        const meta = v.metadata ?? {}
        if (!meta.custom) {
          return true
        }
        return !meta.partner_id || meta.partner_id === partnerId
      })
      .map((v: any) => ({
        id: v.id,
        value: v.value,
        hex: v.metadata?.hex ?? null,
        custom: !!v.metadata?.custom,
      })),
  }))

  res.json({ palettes, count: palettes.length })
}
