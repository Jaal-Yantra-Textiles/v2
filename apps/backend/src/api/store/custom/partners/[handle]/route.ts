import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import { loadPartnerProfile } from "../profile-lib/load-profile"

/**
 * GET /store/custom/partners/:handle
 *
 * PUBLIC page of one partner (#2444): what they make, how much, who works
 * there (by role), measured energy, and their products in this shop. 404
 * unless the partner switched `is_public` on and is active.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const logger: any = req.scope.resolve(ContainerRegistrationKeys.LOGGER)
  try {
    const handle = String(req.params.handle ?? "")
    const salesChannelIds: string[] =
      (req as any).publishable_key_context?.sales_channel_ids ?? []
    const partner = await loadPartnerProfile(req.scope, handle, salesChannelIds)
    if (!partner) {
      res.status(404).json({ message: "Partner not found" })
      return
    }
    res.status(200).json({ partner })
  } catch (error) {
    logger.error("[Store] Error loading partner profile:", error as Error)
    res.status(500).json({ message: "Failed to load partner" })
  }
}
