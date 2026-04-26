import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { SOCIALS_MODULE } from "../../../../../modules/socials"
import type SocialsService from "../../../../../modules/socials/service"
import type { WhatsAppPlatformApiConfig } from "../../../../../modules/socials/types/whatsapp-platform"

/**
 * GET /admin/messaging/whatsapp/senders
 *
 * List WhatsApp Business numbers configured as SocialPlatform rows. Used by
 * the admin messaging UI to populate a per-conversation sender picker.
 * Returns only non-sensitive fields — no tokens or secrets.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const socials = req.scope.resolve(SOCIALS_MODULE) as unknown as SocialsService

  const platforms = await socials.findWhatsAppPlatforms()

  const senders = platforms.map((p: any) => {
    const cfg = (p.api_config ?? {}) as WhatsAppPlatformApiConfig
    return {
      platform_id: p.id,
      name: p.name,
      phone_number_id: cfg.phone_number_id,
      label: cfg.label ?? null,
      display_phone_number: cfg.display_phone_number ?? null,
      verified_name: cfg.verified_name ?? null,
      country_codes: cfg.country_codes ?? [],
      is_default: cfg.is_default === true,
    }
  })

  res.json({ senders, count: senders.length })
}
