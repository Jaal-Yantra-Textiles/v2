// #859 S2 (#861) — resolve the platform's core sales channel for artisan
// cross-listing.
//
// There is no "core store" entity in this platform; the core storefront is
// identified purely by its sales-channel id, held in the CORE_SALES_CHANNEL_ID
// env var (e.g. sc_… of "JYT Medu Store"). We keep a fallback to the legacy
// is_default heuristic so nothing breaks before the env is set — but that
// heuristic is nondeterministic when more than one store is unlinked to a
// partner (both read as is_default), which is exactly why the env var is the
// source of truth.

import { listStorefronts } from "../../api/mcp/lib/store-resolver"

/** Env var holding the core storefront's sales-channel id. */
export const CORE_SALES_CHANNEL_ENV = "CORE_SALES_CHANNEL_ID"

/**
 * Pure pick: prefer the explicitly-configured channel id, else fall back to the
 * default storefront's channel. Kept free of the container so it's unit-testable.
 */
export function pickCoreSalesChannelId(opts: {
  /** Value of CORE_SALES_CHANNEL_ID (or undefined/empty when unset). */
  envChannelId?: string | null
  /** sales_channel_id of the is_default storefront, or null. */
  defaultStorefrontChannelId?: string | null
}): string | null {
  const env = (opts.envChannelId || "").trim()
  if (env) return env
  return opts.defaultStorefrontChannelId || null
}

/**
 * Resolve the core sales-channel id from the container: env first, then the
 * is_default storefront as a fallback. Returns null if neither resolves.
 */
export async function resolveCoreSalesChannelId(
  container: any
): Promise<string | null> {
  const envChannelId = process.env[CORE_SALES_CHANNEL_ENV]

  // Only pay for the storefront enumeration when the env var is unset.
  let defaultStorefrontChannelId: string | null = null
  if (!(envChannelId || "").trim()) {
    try {
      const storefronts = await listStorefronts(container)
      defaultStorefrontChannelId =
        storefronts.find((s) => s.is_default)?.sales_channel_id || null
    } catch {
      defaultStorefrontChannelId = null
    }
  }

  return pickCoreSalesChannelId({ envChannelId, defaultStorefrontChannelId })
}
