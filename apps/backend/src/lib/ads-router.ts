import { MedusaError } from "@medusajs/framework/utils"
import { SOCIALS_MODULE } from "../modules/socials"

/**
 * Unified `/admin/ads/*` routes dispatch to Meta or Google handlers based on
 * the parent SocialPlatform's `category`. Today the rule is simple:
 *   category="google" → Google Ads tables (google_ads_*)
 *   anything else     → Meta tables (ad_account / ad_campaign / ad_set / ad)
 *
 * If a third provider lands, prefer extending this helper over sprinkling
 * the kind decision across every route handler.
 */
export type AdsPlatformKind = "meta" | "google"

export async function resolvePlatformForAds(
  scope: any,
  platformId: string
): Promise<{ kind: AdsPlatformKind; platform: any }> {
  if (!platformId) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "platform_id is required"
    )
  }
  const socials = scope.resolve(SOCIALS_MODULE) as any
  const [platform] = await socials.listSocialPlatforms(
    { id: platformId },
    { take: 1 }
  )
  if (!platform) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Platform ${platformId} not found`
    )
  }
  const category = (platform.category || "").toLowerCase()
  return {
    kind: category === "google" ? "google" : "meta",
    platform,
  }
}

/**
 * Normalize the messy "give me a number" coercion the same way for Meta and
 * Google rows so the wire response doesn't leak per-provider quirks (Meta
 * sometimes returns numeric strings; Google returns a BigNumber-wrapped
 * column with `value`/`precision` siblings).
 */
export function toNumber(value: any): number {
  if (value === null || value === undefined || value === "") return 0
  if (typeof value === "number") return Number.isFinite(value) ? value : 0
  if (typeof value === "string") {
    const n = Number(value)
    return Number.isFinite(n) ? n : 0
  }
  if (typeof value === "object" && value !== null && "value" in value) {
    return toNumber((value as any).value)
  }
  return 0
}

export function parsePositiveInt(
  raw: string | undefined,
  fallback: number,
  max: number
): number {
  const n = Number.parseInt(String(raw ?? ""), 10)
  if (!Number.isFinite(n) || n <= 0) return fallback
  return Math.min(n, max)
}
