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
import { AD_PLANNING_MODULE } from "../../../modules/ad-planning"
import type AdPlanningService from "../../../modules/ad-planning/service"
import { withGoogleRetry } from "../../../modules/social-provider/google-retry"

export type UploadGoogleAdsConversionInput = {
  platform_id: string
  conversion_id: string
  /** From the upstream refreshGoogleTokenStep */
  access_token: string
}

export type UploadGoogleAdsConversionOutput = {
  conversion_id: string
  customer_id: string
  conversion_action: string
  uploaded: boolean
  reason?: string
  partial_failure?: any
}

const ADS_API_BASE = "https://googleads.googleapis.com/v24"

/**
 * Upload one conversion to Google Ads via
 * `customers/{cid}/conversionUploads:uploadClickConversions`.
 *
 * Customer (CID) resolution:
 *   1. `conversion.metadata.google_ads_customer_id` (explicit override)
 *   2. Matched `ConversionGoal.metadata.google_ads.customer_id` (highest priority)
 *   3. The single `ads` binding on the platform (if exactly one)
 *   4. `platform.api_config.google_ads.default_customer_id`
 *
 * Conversion action resource name resolution:
 *   1. `conversion.metadata.google_ads_conversion_action` (explicit override)
 *   2. Matched `ConversionGoal.metadata.google_ads.conversion_action` (highest priority)
 *   3. `platform.api_config.google_ads.default_conversion_action`
 *
 * Goal matching mirrors `updateGoalsStep` in track-conversion: filter by
 * `goal_type = conversion.conversion_type`, `website_id`, `is_active = true`;
 * sort by `priority desc` and pick the first goal whose metadata configures
 * a Google Ads mapping. If no goal matches, fall back to platform-level
 * config — the legacy behavior.
 *
 * gclid is required by Google for click conversions; if missing we record
 * the skip reason on the conversion's metadata and exit successfully without
 * calling the API. This keeps the subscriber idempotent and silent for the
 * common organic / direct conversion case.
 */
export const uploadGoogleAdsConversionStep = createStep(
  "upload-google-ads-conversion-step",
  async (input: UploadGoogleAdsConversionInput, { container }) => {
    const socials = container.resolve(SOCIALS_MODULE) as any
    const encryption = container.resolve(ENCRYPTION_MODULE) as EncryptionService
    const adPlanning = container.resolve(
      AD_PLANNING_MODULE
    ) as AdPlanningService
    const logger = container.resolve(ContainerRegistrationKeys.LOGGER) as Logger

    const [conversion] = await adPlanning.listConversions(
      { id: input.conversion_id },
      { take: 1 }
    )
    if (!conversion) {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        `Conversion ${input.conversion_id} not found`
      )
    }
    const meta = (conversion.metadata || {}) as Record<string, any>

    const gclid = meta.gclid || meta.gbraid || meta.wbraid
    if (!gclid) {
      const skip = "missing gclid/gbraid/wbraid in conversion metadata"
      await markUploadSkipped(adPlanning, conversion.id, meta, skip)
      return new StepResponse<UploadGoogleAdsConversionOutput>({
        conversion_id: conversion.id,
        customer_id: "",
        conversion_action: "",
        uploaded: false,
        reason: skip,
      })
    }

    const [platform] = await socials.listSocialPlatforms(
      { id: input.platform_id },
      { take: 1 }
    )
    if (!platform) {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        `SocialPlatform ${input.platform_id} not found`
      )
    }
    const apiConfig = (platform.api_config || {}) as Record<string, any>
    const googleAdsConfig = (apiConfig.google_ads || {}) as Record<string, any>

    if (!apiConfig.developer_token_encrypted) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Google Ads conversion upload requires a developer token on the platform row"
      )
    }
    const developerToken = encryption.decrypt(
      apiConfig.developer_token_encrypted
    )

    const goalMapping = await resolveGoalMapping(adPlanning, conversion)

    const customerId = await resolveCustomerId({
      socials,
      platform_id: input.platform_id,
      explicit: meta.google_ads_customer_id,
      goalCustomerId: goalMapping?.customer_id,
      fallback: googleAdsConfig.default_customer_id,
    })
    if (!customerId) {
      const skip =
        "could not resolve a Google Ads customer_id (no metadata override, more than one ads binding, no default)"
      await markUploadSkipped(adPlanning, conversion.id, meta, skip)
      return new StepResponse<UploadGoogleAdsConversionOutput>({
        conversion_id: conversion.id,
        customer_id: "",
        conversion_action: "",
        uploaded: false,
        reason: skip,
      })
    }

    const conversionAction =
      meta.google_ads_conversion_action ||
      goalMapping?.conversion_action ||
      googleAdsConfig.default_conversion_action ||
      null
    if (!conversionAction) {
      const skip =
        "no conversion_action configured (set conversion.metadata.google_ads_conversion_action, ConversionGoal.metadata.google_ads.conversion_action, or api_config.google_ads.default_conversion_action)"
      await markUploadSkipped(adPlanning, conversion.id, meta, skip)
      return new StepResponse<UploadGoogleAdsConversionOutput>({
        conversion_id: conversion.id,
        customer_id: customerId,
        conversion_action: "",
        uploaded: false,
        reason: skip,
      })
    }

    const convertedAt = conversion.converted_at
      ? new Date(conversion.converted_at as any)
      : new Date()
    const conversionDateTime = formatGoogleAdsDateTime(convertedAt)

    const value = numericFromBigNumber(conversion.conversion_value)
    const orderId = (conversion.order_id as string | null) || undefined

    const body = {
      conversions: [
        {
          gclid,
          conversionAction,
          conversionDateTime,
          conversionValue: value ?? undefined,
          currencyCode: conversion.currency || undefined,
          orderId,
        },
      ],
      // Validate-only mode for very-conservative deploys; toggleable at platform level
      validateOnly: !!googleAdsConfig.validate_only,
      partialFailure: true,
    }

    try {
      const response = await withGoogleRetry(
        () =>
          axios.post(
            `${ADS_API_BASE}/customers/${customerId}/conversionUploads:uploadClickConversions`,
            body,
            {
              headers: {
                Authorization: `Bearer ${input.access_token}`,
                "developer-token": developerToken,
                "Content-Type": "application/json",
              },
            }
          ),
        {
          label: `ads.conversionUploads(${customerId})`,
          logger,
          maxAttempts: 3,
        }
      )

      const partialFailure = response.data?.partialFailureError
      const accepted = response.data?.results?.[0]
      const uploaded = !partialFailure && !!accepted

      await markUploadResult(adPlanning, conversion.id, meta, {
        uploaded,
        customer_id: customerId,
        conversion_action: conversionAction,
        goal_id: goalMapping?.goal_id ?? null,
        partial_failure: partialFailure,
      })

      return new StepResponse<UploadGoogleAdsConversionOutput>({
        conversion_id: conversion.id,
        customer_id: customerId,
        conversion_action: conversionAction,
        uploaded,
        partial_failure: partialFailure,
      })
    } catch (e: any) {
      const msg = e.response?.data?.error?.message || e.message
      await markUploadError(adPlanning, conversion.id, meta, msg)
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        `Google Ads conversion upload failed: ${msg}`
      )
    }
  }
)

async function resolveCustomerId({
  socials,
  platform_id,
  explicit,
  goalCustomerId,
  fallback,
}: {
  socials: any
  platform_id: string
  explicit?: string
  goalCustomerId?: string
  fallback?: string
}): Promise<string | null> {
  if (explicit) return String(explicit)
  if (goalCustomerId) return String(goalCustomerId)
  const bindings = await socials.listSocialPlatformBindings({
    platform_id,
    service: "ads",
  })
  if (bindings.length === 1) return String(bindings[0].resource_id)
  if (fallback) return String(fallback)
  return null
}

/**
 * Re-runs the same goal match `updateGoalsStep` in track-conversion uses,
 * sorted by priority desc, and returns the first goal whose `metadata`
 * carries a Google Ads mapping. Returns `null` when no goal matches or
 * none of the matches are wired to Google Ads.
 *
 * Filters mirror `updateGoalsStep` exactly so a goal that increments
 * counters is the same goal whose mapping we honor here.
 */
async function resolveGoalMapping(
  adPlanning: AdPlanningService,
  conversion: any
): Promise<{
  goal_id: string
  customer_id?: string
  conversion_action?: string
} | null> {
  const filters: Record<string, any> = {
    goal_type: conversion.conversion_type,
    is_active: true,
  }
  if (conversion.website_id) {
    filters.website_id = conversion.website_id
  }

  const goals = await adPlanning.listConversionGoals(filters)
  if (goals.length === 0) return null

  // Highest priority wins among the goals that actually configure Google Ads.
  // We don't consider goals without a google_ads block — those goals exist to
  // count generic events, not to drive ad-network uploads.
  const sorted = [...goals].sort(
    (a: any, b: any) => (b.priority ?? 0) - (a.priority ?? 0)
  )
  for (const goal of sorted) {
    const ga = (((goal.metadata as Record<string, any>) || {}).google_ads ||
      {}) as Record<string, any>
    if (ga.conversion_action || ga.customer_id) {
      return {
        goal_id: goal.id,
        customer_id: ga.customer_id,
        conversion_action: ga.conversion_action,
      }
    }
  }
  return null
}

function formatGoogleAdsDateTime(d: Date): string {
  // Google Ads expects "YYYY-MM-DD HH:mm:ss±HH:MM" — JS toISOString gives Z,
  // which Ads accepts as "+00:00" only with the right separator. Easiest is
  // to format UTC explicitly.
  const pad = (n: number) => String(n).padStart(2, "0")
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ` +
    `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}+00:00`
  )
}

function numericFromBigNumber(v: any): number | null {
  if (v == null) return null
  if (typeof v === "number") return v
  if (typeof v === "string") {
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  }
  // MikroORM BigNumber is serialized as { value, precision }
  if (typeof v === "object" && "value" in v) {
    const n = Number(v.value)
    return Number.isFinite(n) ? n : null
  }
  return null
}

async function markUploadSkipped(
  adPlanning: AdPlanningService,
  conversion_id: string,
  meta: Record<string, any>,
  reason: string
) {
  await adPlanning.updateConversions({
    id: conversion_id,
    metadata: {
      ...meta,
      google_ads_uploaded_at: null,
      google_ads_upload_skipped_at: new Date().toISOString(),
      google_ads_upload_skip_reason: reason,
    },
  })
}

async function markUploadResult(
  adPlanning: AdPlanningService,
  conversion_id: string,
  meta: Record<string, any>,
  result: {
    uploaded: boolean
    customer_id: string
    conversion_action: string
    goal_id: string | null
    partial_failure?: any
  }
) {
  await adPlanning.updateConversions({
    id: conversion_id,
    metadata: {
      ...meta,
      google_ads_uploaded_at: result.uploaded ? new Date().toISOString() : null,
      google_ads_customer_id: result.customer_id,
      google_ads_conversion_action: result.conversion_action,
      google_ads_matched_goal_id: result.goal_id,
      google_ads_partial_failure: result.partial_failure ?? null,
      google_ads_upload_error: null,
    },
  })
}

async function markUploadError(
  adPlanning: AdPlanningService,
  conversion_id: string,
  meta: Record<string, any>,
  message: string
) {
  await adPlanning.updateConversions({
    id: conversion_id,
    metadata: {
      ...meta,
      google_ads_upload_error: message.slice(0, 1000),
      google_ads_upload_failed_at: new Date().toISOString(),
    },
  })
}
