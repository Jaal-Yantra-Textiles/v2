import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { SOCIALS_MODULE } from "../../../../../modules/socials"
import SocialsService from "../../../../../modules/socials/service"
import MetaAdsService from "../../../../../modules/social-provider/meta-ads-service"
import { decryptAccessToken, decryptUserAccessToken } from "../../../../../modules/socials/utils/token-helpers"

/**
 * POST /admin/meta-ads/accounts/sync
 * 
 * Sync ad accounts from Meta for a platform
 * 
 * Body:
 * - platform_id: Platform ID to sync from (required)
 */
export const POST = async (
  req: MedusaRequest,
  res: MedusaResponse
) => {
  try {
    const socials = req.scope.resolve(SOCIALS_MODULE) as SocialsService
    const body = req.body as Record<string, any>
    
    const { platform_id } = body

    if (!platform_id) {
      return res.status(400).json({
        message: "platform_id is required",
      })
    }

    // Get platform and access token
    const platform = await socials.retrieveSocialPlatform(platform_id)
    
    if (!platform) {
      return res.status(404).json({
        message: "Platform not found",
      })
    }

    const apiConfig = platform.api_config as any
    if (!apiConfig) {
      return res.status(400).json({
        message: "Platform has no API configuration",
      })
    }

    // Get USER access token - required for ad account access
    // The user token is stored separately from the page token
    let accessToken = decryptUserAccessToken(apiConfig, req.scope)
    
    // Fallback to generic access token if no user token
    if (!accessToken) {
      console.log("No user_access_token found, trying generic access_token...")
      accessToken = decryptAccessToken(apiConfig, req.scope)
    }
    
    if (!accessToken) {
      return res.status(400).json({
        message: "No access token available",
      })
    }
    
    console.log("Using access token for ad accounts sync...")

    const metaAds = new MetaAdsService()
    const results = {
      created: 0,
      updated: 0,
      errors: 0,
      error_messages: [] as string[],
    }

    // Fetch ad accounts from Meta using user access token
    let metaAccounts: any[] = []
    try {
      metaAccounts = await metaAds.listAdAccounts(accessToken)
    } catch (error: any) {
      // If the token is a page token, we can't access ad accounts directly
      // The user needs to re-authenticate with ads_management permission
      if (error.message?.includes("nonexisting field (adaccounts)") || 
          error.message?.includes("Page")) {
        return res.status(400).json({
          message: "Cannot access ad accounts with current token. Please re-authenticate with Facebook to grant ads permissions.",
          error: "The stored token is a Page token, not a User token. Ad accounts can only be accessed with a User Access Token that has ads_management permission.",
        })
      }
      throw error
    }

    console.log(`Found ${metaAccounts.length} ad accounts from Meta`)

    for (const metaAccount of metaAccounts) {
      try {
        // Check if account already exists
        const existingAccounts = await socials.listAdAccounts({
          meta_account_id: metaAccount.id,
        })

        const accountData = {
          meta_account_id: metaAccount.id,
          name: metaAccount.name,
          currency: metaAccount.currency,
          timezone: metaAccount.timezone_name || null,
          business_name: metaAccount.business_name || metaAccount.business?.name || null,
          business_id: metaAccount.business?.id || null,
          status: metaAccount.account_status === 1 ? "active" as const : "disabled" as const,
          account_status: metaAccount.account_status,
          disable_reason: metaAccount.disable_reason?.toString() || null,
          amount_spent: parseFloat(metaAccount.amount_spent) || 0,
          spend_cap: metaAccount.spend_cap ? parseFloat(metaAccount.spend_cap) : null,
          balance: metaAccount.balance ? parseFloat(metaAccount.balance) : null,
          min_daily_budget: metaAccount.min_daily_budget || null,
          last_synced_at: new Date(),
          sync_status: "synced" as const,
          platform_id: platform_id,
        }

        if (existingAccounts.length > 0) {
          // Update existing account
          await socials.updateAdAccounts([{
            selector: { id: existingAccounts[0].id },
            data: accountData,
          }])
          results.updated++
        } else {
          // Create new account
          await socials.createAdAccounts(accountData as any)
          results.created++
        }
      } catch (error) {
        console.error(`Failed to sync account ${metaAccount.id}:`, error)
        results.errors++
      }
    }

    res.json({
      message: "Ad account sync completed",
      results,
    })
  } catch (error: any) {
    console.error("Failed to sync ad accounts:", error)
    res.status(500).json({
      message: "Failed to sync ad accounts",
      error: error.message,
    })
  }
}
