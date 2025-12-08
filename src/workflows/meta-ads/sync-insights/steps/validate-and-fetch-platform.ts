import { MedusaError } from "@medusajs/framework/utils"
import { StepResponse, createStep } from "@medusajs/framework/workflows-sdk"
import { SOCIALS_MODULE } from "../../../../modules/socials"
import SocialsService from "../../../../modules/socials/service"
import { decryptAccessToken } from "../../../../modules/socials/utils/token-helpers"
import { SyncInsightsInput, PlatformData, AdAccountData } from "../types"

export const validateAndFetchPlatformStepId = "validate-and-fetch-platform"

/**
 * Step 1: Validate input and fetch platform/ad account data
 * 
 * This step:
 * - Validates required inputs
 * - Fetches the platform and decrypts access token
 * - Fetches the ad account details
 */
export const validateAndFetchPlatformStep = createStep(
  validateAndFetchPlatformStepId,
  async (input: SyncInsightsInput, { container }) => {
    const socials = container.resolve(SOCIALS_MODULE) as SocialsService

    // Validate required fields
    if (!input.platform_id) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "platform_id is required"
      )
    }

    if (!input.ad_account_id) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "ad_account_id is required"
      )
    }

    // Fetch platform
    const platform = await socials.retrieveSocialPlatform(input.platform_id)
    
    if (!platform) {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        "Platform not found"
      )
    }

    const apiConfig = platform.api_config as any
    if (!apiConfig) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Platform has no API configuration"
      )
    }

    // Decrypt access token
    const accessToken = decryptAccessToken(apiConfig, container)
    
    if (!accessToken) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "No access token available"
      )
    }

    // Fetch ad account
    const adAccounts = await socials.listAdAccounts({ meta_account_id: input.ad_account_id })
    const adAccount = adAccounts[0]
    
    if (!adAccount) {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        "Ad account not found"
      )
    }

    console.log(`[SyncInsights] Validated platform: ${platform.name}, account: ${adAccount.name}`)

    return new StepResponse({
      platform: {
        id: platform.id,
        name: platform.name,
        accessToken,
      } as PlatformData,
      adAccount: {
        id: adAccount.id,
        meta_account_id: (adAccount as any).meta_account_id,
        name: adAccount.name,
        currency: (adAccount as any).currency || "USD",
      } as AdAccountData,
      level: input.level || "campaign",
      datePreset: input.date_preset || "last_30d",
      timeIncrement: input.time_increment || "1",
    })
  }
)
