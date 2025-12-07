import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { SOCIALS_MODULE } from "../../../../../modules/socials"
import SocialsService from "../../../../../modules/socials/service"

/**
 * GET /admin/meta-ads/accounts/:id
 * 
 * Get a single ad account by ID
 */
export const GET = async (
  req: MedusaRequest,
  res: MedusaResponse
) => {
  try {
    const socials = req.scope.resolve(SOCIALS_MODULE) as SocialsService
    const { id } = req.params

    const account = await socials.retrieveAdAccount(id)
    
    if (!account) {
      return res.status(404).json({
        message: "Ad account not found",
      })
    }

    res.json({ account })
  } catch (error: any) {
    console.error("Failed to get ad account:", error)
    res.status(500).json({
      message: "Failed to get ad account",
      error: error.message,
    })
  }
}
