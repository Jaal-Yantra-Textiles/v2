import axios from "axios"
import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"
import {
  ContainerRegistrationKeys,
  MedusaError,
} from "@medusajs/framework/utils"
import type { Logger } from "@medusajs/types"
import { SOCIALS_MODULE } from "../../../modules/socials"
import { ENCRYPTION_MODULE } from "../../../modules/encryption"
import type EncryptionService from "../../../modules/encryption/service"
import { withGoogleRetry } from "../../../modules/social-provider/google-retry"

export type ListConversionActionsInput = {
  platform_id: string
  customer_id: string
  /** From the upstream refreshGoogleTokenStep */
  access_token: string
}

export type ConversionActionRow = {
  /** Full Google resource name — what the operator pastes into goal/platform config */
  resource_name: string
  /** Numeric ID for picker stable keys */
  conversion_action_id: string
  name: string
  type: string | null
  status: string | null
  category: string | null
  /** Whether the action contributes to "Conversions" metric in Ads UI */
  include_in_conversions_metric: boolean | null
}

export type ListConversionActionsOutput = {
  customer_id: string
  conversion_actions: ConversionActionRow[]
}

const ADS_API_BASE = "https://googleads.googleapis.com/v24"

const QUERY = `
  SELECT
    conversion_action.id,
    conversion_action.resource_name,
    conversion_action.name,
    conversion_action.type,
    conversion_action.status,
    conversion_action.category,
    conversion_action.include_in_conversions_metric
  FROM conversion_action
`.replace(/\s+/g, " ").trim()

/**
 * Read-only GAQL fetch of `conversion_action` for one CID. Backs the
 * conversion-action picker on the platform-defaults drawer and the
 * (future) per-goal mapping drawer in ad-planning.
 *
 * Why GAQL instead of a REST list endpoint: Google Ads doesn't expose a
 * REST `list` for conversion_action — only searchStream/search via GAQL.
 *
 * Returns both the resource_name (what callers will store) and the numeric
 * id (for stable picker keys). Order is whatever Google returns; the UI
 * sorts as needed.
 */
export const listConversionActionsStep = createStep(
  "list-google-ads-conversion-actions-step",
  async (input: ListConversionActionsInput, { container }) => {
    const socials = container.resolve(SOCIALS_MODULE) as any
    const encryption = container.resolve(ENCRYPTION_MODULE) as EncryptionService
    const logger = container.resolve(ContainerRegistrationKeys.LOGGER) as Logger

    const developerToken = await readDeveloperToken(
      input.platform_id,
      socials,
      encryption
    )
    if (!developerToken) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Google Ads requires a developer token on the platform row"
      )
    }

    try {
      const response = await withGoogleRetry(
        () =>
          axios.post(
            `${ADS_API_BASE}/customers/${input.customer_id}/googleAds:searchStream`,
            { query: QUERY },
            {
              headers: {
                Authorization: `Bearer ${input.access_token}`,
                "developer-token": developerToken,
                "Content-Type": "application/json",
              },
            }
          ),
        {
          label: `ads.conversionActions.list(${input.customer_id})`,
          logger,
          maxAttempts: 3,
        }
      )

      const rows = extractAllRows(response.data)
      const out: ConversionActionRow[] = rows.map((r) => {
        const ca = r.conversionAction || r.conversion_action || {}
        return {
          resource_name: ca.resourceName || ca.resource_name || "",
          conversion_action_id: String(ca.id ?? ""),
          name: ca.name || "",
          type: ca.type ?? null,
          status: ca.status ?? null,
          category: ca.category ?? null,
          include_in_conversions_metric:
            ca.includeInConversionsMetric ??
            ca.include_in_conversions_metric ??
            null,
        }
      })

      return new StepResponse<ListConversionActionsOutput>({
        customer_id: input.customer_id,
        conversion_actions: out,
      })
    } catch (e: any) {
      const msg = e.response?.data?.error?.message || e.message
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `Google Ads conversion_action list failed: ${msg}`
      )
    }
  }
)

function extractAllRows(data: any): any[] {
  if (!data) return []
  if (Array.isArray(data)) {
    return data.flatMap((chunk) => chunk?.results || [])
  }
  return data.results || []
}

async function readDeveloperToken(
  platform_id: string,
  socials: any,
  encryption: EncryptionService
): Promise<string | null> {
  const [platform] = await socials.listSocialPlatforms(
    { id: platform_id },
    { take: 1 }
  )
  if (!platform) return null
  const apiConfig = (platform.api_config || {}) as Record<string, any>
  if (!apiConfig.developer_token_encrypted) return null
  try {
    return encryption.decrypt(apiConfig.developer_token_encrypted)
  } catch {
    return null
  }
}
