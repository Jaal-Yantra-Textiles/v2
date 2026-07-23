import { parsePlatformFeeBps, type FeeBasis } from "./compute-fee"
import { PARTNER_ONBOARDING_PROFILE_MODULE } from "../partner-onboarding-profile"

/**
 * #336 Slice 1 — partner commission fee-rate resolution.
 *
 * Resolves the commission rate to apply to a partner's order, mirroring the
 * `resolveStoreCurrency` (#485, `src/lib/resolve-store-currency.ts`)
 * "resolve-with-fallback" template:
 *
 *   per-partner override  →  platform default (env)  →  hard-coded default
 *
 * The locked #336 decision is a flat 2% platform commission
 * (`PLATFORM_TX_FEE_BPS=200`, percentage basis) with **per-partner overrides
 * deferred** to a later slice. `partnerId` is threaded through now so the
 * accrual subscriber (Slice 2) and read API (Slice 4) call a stable signature
 * once overrides land — no call-site churn needed then.
 *
 * Never throws — fee resolution is best-effort and must never break order
 * placement; it always returns a usable rate.
 */

/** Platform default commission when no env value is configured: 2.00% (#336 locked). */
export const PLATFORM_DEFAULT_FEE_BPS = 200

/** Retail-split defaults: 2% payment gateway + 15% platform commission. */
export const PLATFORM_DEFAULT_GATEWAY_BPS = 200
export const PLATFORM_DEFAULT_COMMISSION_BPS = 1500

export type ResolvedRetailFeeRates = {
  /** Payment-gateway component, basis points (200 = 2.00%). */
  gateway_bps: number
  /** Platform-commission component, basis points (1500 = 15.00%). */
  commission_bps: number
}

/**
 * Resolve the retail order fee components for a partner.
 *
 * - Gateway: `PLATFORM_GATEWAY_FEE_BPS` env → default 200 (2%). Fixed platform
 *   cost, not partner-negotiable.
 * - Commission: the partner's onboarding `commission_bps` override →
 *   `PLATFORM_COMMISSION_FEE_BPS` env → default 1500 (15%).
 *
 * Best-effort: override lookup never throws (see
 * `resolvePartnerCommissionOverrideBps`).
 */
export async function resolveRetailFeeRates(
  container: any,
  opts: ResolvePartnerFeeRateOpts = {}
): Promise<ResolvedRetailFeeRates> {
  const gateway_bps = parsePlatformFeeBps(
    process.env.PLATFORM_GATEWAY_FEE_BPS,
    PLATFORM_DEFAULT_GATEWAY_BPS
  )
  const overrideBps = await resolvePartnerCommissionOverrideBps(
    container,
    opts.partnerId
  )
  const commission_bps =
    overrideBps != null && Number.isFinite(Number(overrideBps)) && overrideBps >= 0
      ? Math.trunc(overrideBps)
      : parsePlatformFeeBps(
          process.env.PLATFORM_COMMISSION_FEE_BPS,
          PLATFORM_DEFAULT_COMMISSION_BPS
        )
  return { gateway_bps, commission_bps }
}

export type ResolvedFeeRate = {
  fee_basis: FeeBasis
  /** For percentage basis: basis points (200 = 2.00%). */
  fee_rate: number
}

/**
 * Pure precedence: a valid per-partner override (basis points, finite & >= 0)
 * wins over the platform default; otherwise the default applies. Always returns
 * a percentage-basis rate. Exported for unit testing — keeps the precedence
 * verifiable without booting the container.
 */
export function pickFeeRate(
  overrideBps: number | null | undefined,
  defaultBps: number
): ResolvedFeeRate {
  const o = Number(overrideBps)
  if (overrideBps != null && Number.isFinite(o) && o >= 0) {
    return { fee_basis: "percentage", fee_rate: Math.trunc(o) }
  }
  return { fee_basis: "percentage", fee_rate: defaultBps }
}

export type ResolvePartnerFeeRateOpts = {
  /**
   * The partner the order is being accrued for. Used to look up a per-partner
   * commission override (the agreed rate captured during onboarding).
   */
  partnerId?: string | null
}

/**
 * The per-partner commission override, in basis points, or null.
 *
 * Source (#859 S1 / #860): the partner's onboarding profile `commission_bps`
 * — the agreed revenue-share for a `core_channel_listing` artisan. Never
 * throws: any resolution failure (missing module, no profile, bad value)
 * falls back to null so the platform default applies and order placement is
 * never broken. Exported for testing.
 */
export async function resolvePartnerCommissionOverrideBps(
  container: any,
  partnerId?: string | null
): Promise<number | null> {
  if (!partnerId) return null
  try {
    const service: any = container?.resolve?.(PARTNER_ONBOARDING_PROFILE_MODULE)
    if (!service?.findByPartner) return null
    const profile = await service.findByPartner(partnerId)
    const bps = profile?.commission_bps
    return bps == null ? null : Number(bps)
  } catch {
    return null
  }
}

/**
 * Resolve the commission rate for a partner's order.
 *
 * Precedence: the partner's onboarding-agreed `commission_bps` override →
 * the platform default from `PLATFORM_TX_FEE_BPS` (200 = 2%), percentage basis.
 * Best-effort: override lookup never throws (see
 * `resolvePartnerCommissionOverrideBps`).
 */
export async function resolvePartnerFeeRate(
  container: any,
  opts: ResolvePartnerFeeRateOpts = {}
): Promise<ResolvedFeeRate> {
  const defaultBps = parsePlatformFeeBps(
    process.env.PLATFORM_TX_FEE_BPS,
    PLATFORM_DEFAULT_FEE_BPS
  )
  const overrideBps = await resolvePartnerCommissionOverrideBps(
    container,
    opts.partnerId
  )
  return pickFeeRate(overrideBps, defaultBps)
}
