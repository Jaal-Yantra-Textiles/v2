/**
 * @module MetaAdsAccountsRoute
 * @description This module handles the API routes for managing Meta Ads accounts.
 * It provides endpoints to retrieve, create, update, and delete Meta Ads accounts.
 * The routes are protected and require authentication.
 *
 * @example
 * // Example of retrieving an ad account
 * // GET /admin/meta-ads/accounts/:id
 * // Headers: { Authorization: "Bearer <token>" }
 * // Response: { account: { id: string, name: string, ... } }
 *
 * @example
 * // Example of creating an ad account
 * // POST /admin/meta-ads/accounts
 * // Headers: { Authorization: "Bearer <token>" }
 * // Body: { name: string, accessToken: string, ... }
 * // Response: { account: { id: string, name: string, ... } }
 *
 * @example
 * // Example of updating an ad account
 * // PUT /admin/meta-ads/accounts/:id
 * // Headers: { Authorization: "Bearer <token>" }
 * // Body: { name: string, ... }
 * // Response: { account: { id: string, name: string, ... } }
 *
 * @example
 * // Example of deleting an ad account
 * // DELETE /admin/meta-ads/accounts/:id
 * // Headers: { Authorization: "Bearer <token>" }
 * // Response: { success: boolean }
 */
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
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
  const logger: any = req.scope.resolve(ContainerRegistrationKeys.LOGGER)
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
    logger.error("Failed to get ad account:", error)
    res.status(500).json({
      message: "Failed to get ad account",
      error: error.message,
    })
  }
}
