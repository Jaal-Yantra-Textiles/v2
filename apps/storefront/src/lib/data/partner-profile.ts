"use server"

import { sdk } from "@lib/config"
import { getCacheOptions } from "./cookies"

export type PartnerCapability = {
  id: string
  title: string
  technique: string | null
  material: string | null
  product_type: string | null
  actions: string[]
  images: Array<{ url: string; alt: string }>
}

export type PartnerProfile = {
  id: string
  name: string
  handle: string
  logo: string | null
  country_code: string | null
  tagline: string | null
  about: string | null
  cover_image: string | null
  team_size: number | null
  /** Counts only; the page never names people (#2444). */
  roles: Array<{ role: string; count: number }>
  capabilities: PartnerCapability[]
  making: {
    pieces_made: number
    samples_made: number
    pieces_last_90_days: number
    making_since: string | null
  }
  /** Measured only; null when nothing was measured. */
  energy: { electricity_kwh: number; water_liters: number; gas_cubic_meters: number } | null
  products: Array<{ id: string; title: string; handle: string; thumbnail: string | null }>
}

/** Same freshness as the production story: a page switched off goes within 5 min. */
const PROFILE_CACHE_TTL_SECONDS = 300

export const getPartnerProfile = async (
  handle: string
): Promise<PartnerProfile | null> => {
  const next = {
    ...(await getCacheOptions("partner-profile")),
    revalidate: PROFILE_CACHE_TTL_SECONDS,
  }
  return sdk.client
    .fetch<{ partner: PartnerProfile }>(
      `/store/custom/partners/${encodeURIComponent(handle)}`,
      { next }
    )
    .then((r) => r.partner ?? null)
    .catch(() => null)
}
