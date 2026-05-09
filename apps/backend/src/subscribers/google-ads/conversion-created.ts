/**
 * Google Ads Conversion Upload Subscriber
 *
 * Reactively pushes ad-planning conversions to Google Ads when:
 *   - The conversion's `platform` is "google"
 *   - The conversion's metadata carries a click identifier (gclid/gbraid/wbraid)
 *   - We can resolve a SocialPlatform row carrying the Google Ads developer
 *     token + a target customer_id
 *
 * The upload step itself is silent on misconfiguration (records the skip
 * reason on the conversion's metadata) — this subscriber only filters out
 * the obvious non-applicable cases up front to avoid spawning a workflow
 * that would no-op anyway.
 */

import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { SOCIALS_MODULE } from "../../modules/socials"
import { AD_PLANNING_MODULE } from "../../modules/ad-planning"
import type AdPlanningService from "../../modules/ad-planning/service"
import { uploadGoogleAdsConversionWorkflow } from "../../workflows/google-ads/upload-conversion"

type ConversionCreatedEvent = {
  id: string
}

export default async function googleAdsConversionCreatedHandler({
  event: { data },
  container,
}: SubscriberArgs<ConversionCreatedEvent>) {
  const logger = container.resolve("logger") as any
  if (!data?.id) return

  try {
    const adPlanning = container.resolve(
      AD_PLANNING_MODULE
    ) as AdPlanningService
    const [conversion] = await adPlanning.listConversions(
      { id: data.id },
      { take: 1 }
    )
    if (!conversion) return

    if (conversion.platform !== "google") return

    const meta = (conversion.metadata || {}) as Record<string, any>
    const hasClickId = !!(meta.gclid || meta.gbraid || meta.wbraid)
    if (!hasClickId) return

    const platformId = await resolvePlatformId({
      container,
      explicit: meta.google_ads_platform_id,
    })
    if (!platformId) {
      logger?.debug?.(
        `[google-ads] skipping conversion ${conversion.id}: no google platform_id resolved`
      )
      return
    }

    await uploadGoogleAdsConversionWorkflow(container).run({
      input: {
        platform_id: platformId,
        conversion_id: conversion.id,
      },
    })
  } catch (error: any) {
    // We swallow here because the workflow already records the failure on
    // the conversion's metadata for observability. Re-throwing would just
    // crash the subscriber pipeline for downstream handlers.
    logger?.warn?.(
      `[google-ads] conversion upload subscriber failed for ${data.id}: ${error.message}`
    )
  }
}

async function resolvePlatformId({
  container,
  explicit,
}: {
  container: any
  explicit?: string
}): Promise<string | null> {
  if (explicit) return String(explicit)
  const socials = container.resolve(SOCIALS_MODULE) as any
  const candidates = await socials.listSocialPlatforms(
    { category: "google" },
    { take: 10 }
  )
  // Auto-select only when there's exactly one connected google platform with
  // an Ads upload config wired up. Anything ambiguous is a config error and
  // we'd rather skip than silently pick the wrong account.
  const eligible = candidates.filter((p: any) => {
    const cfg = (p.api_config || {}) as Record<string, any>
    if (!cfg.developer_token_encrypted) return false
    const ga = (cfg.google_ads || {}) as Record<string, any>
    return !!(ga.default_customer_id || ga.default_conversion_action)
  })
  if (eligible.length === 1) return eligible[0].id
  return null
}

export const config: SubscriberConfig = {
  event: "conversion.created",
}
