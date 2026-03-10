import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { SOCIALS_MODULE } from "../../../../modules/socials"
import SocialsService from "../../../../modules/socials/service"
import MetaAdsService from "../../../../modules/social-provider/meta-ads-service"
import { decryptAccessToken } from "../../../../modules/socials/utils/token-helpers"

/**
 * GET /webhooks/meta-ads/leadgen
 * Meta webhook verification handshake
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const mode = req.query["hub.mode"]
  const token = req.query["hub.verify_token"]
  const challenge = req.query["hub.challenge"]

  if (mode === "subscribe" && token === process.env.META_WEBHOOK_VERIFY_TOKEN) {
    return res.status(200).send(challenge)
  }
  res.status(403).json({ error: "Forbidden" })
}

/**
 * POST /webhooks/meta-ads/leadgen
 * Receive lead notifications from Meta and upsert to DB
 */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  // Acknowledge immediately — Meta expects a fast 200
  res.status(200).json({ received: true })

  try {
    const body = req.body as any
    const leadgenIds: string[] = []

    for (const entry of body?.entry ?? []) {
      for (const change of entry?.changes ?? []) {
        if (change?.value?.leadgen_id) {
          leadgenIds.push(change.value.leadgen_id)
        }
      }
    }

    if (leadgenIds.length === 0) return

    const socials = req.scope.resolve(SOCIALS_MODULE) as SocialsService
    const metaAds = new MetaAdsService()

    // Find active Facebook platform
    const platforms = await socials.listSocialPlatforms({ platform_type: "facebook" } as any)
    const platform = platforms?.[0]
    if (!platform) return

    const apiConfig = (platform as any).api_config as Record<string, any>
    if (!apiConfig) return
    const accessToken = decryptAccessToken(apiConfig, req.scope)

    for (const leadgenId of leadgenIds) {
      try {
        const lead = await metaAds.getLead(leadgenId, accessToken)
        const contact = metaAds.extractLeadContactInfo(lead.field_data || [])
        await socials.createLeads([
          {
            meta_lead_id: leadgenId,
            ...contact,
            platform_id: platform.id,
          },
        ] as any)
      } catch {
        // Individual lead failures should not block others
      }
    }
  } catch {
    // Background processing — errors are silent to avoid blocking the response
  }
}
