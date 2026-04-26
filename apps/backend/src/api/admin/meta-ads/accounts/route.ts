/**
 * @module admin/meta-ads/accounts
 * @description This module handles the creation and listing of Meta ad accounts.
 * It provides endpoints to manage ad accounts in the JYT Commerce API.
 *
 * @requires @medusajs/framework/http
 * @requires ../../../../modules/socials
 * @requires ../../../../modules/socials/service
 *
 * @exports GET - Lists all synced ad accounts
 * @exports POST - Creates an ad account
 *
 * @example
 * // Example of listing ad accounts
 * // GET /admin/meta-ads/accounts
 * // Response:
 * // {
 * //   "accounts": [
 * //     {
 * //       "id": "act_123456789",
 * //       "name": "My Ad Account",
 * //       "currency": "USD",
 * //       "timezone_name": "America/New_York",
 * //       "created_time": "2023-01-01T00:00:00Z"
 * //     }
 * //   ],
 * //   "count": 1
 * // }
 *
 * @example
 * // Example of creating an ad account
 * // POST /admin/meta-ads/accounts
 * // Request body:
 * // {
 * //   "name": "New Ad Account",
 * //   "currency": "USD",
 * //   "timezone_name": "America/New_York"
 * // }
 * // Response:
 * // {
 * //   "account": {
 * //     "id": "act_987654321",
 * //     "name": "New Ad Account",
 * //     "currency": "USD",
 * //     "timezone_name": "America/New_York",
 * //     "created_time": "2023-01-01T00:00:00Z"
 * //   }
 * // }
 */
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { SOCIALS_MODULE } from "../../../../modules/socials"
import SocialsService from "../../../../modules/socials/service"

/**
 * GET /admin/meta-ads/accounts
 * 
 * List all synced ad accounts
 */
export const GET = async (
  req: MedusaRequest,
  res: MedusaResponse
) => {
  try {
    const socials = req.scope.resolve(SOCIALS_MODULE) as SocialsService
    
    const accounts = await socials.listAdAccounts({}, {
      order: { name: "ASC" },
    })

    res.json({
      accounts,
      count: accounts.length,
    })
  } catch (error: any) {
    console.error("Failed to list ad accounts:", error)
    res.status(500).json({
      message: "Failed to list ad accounts",
      error: error.message,
    })
  }
}

/**
 * POST /admin/meta-ads/accounts
 * 
 * Create an ad account
 */
export const POST = async (
  req: MedusaRequest,
  res: MedusaResponse
) => {
  try {
    const socials = req.scope.resolve(SOCIALS_MODULE) as SocialsService
    const body = req.body as Record<string, any>
    
    const account = await socials.createAdAccounts(body)

    res.json({ account })
  } catch (error: any) {
    console.error("Failed to create ad account:", error)
    res.status(500).json({
      message: "Failed to create ad account",
      error: error.message,
    })
  }
}
