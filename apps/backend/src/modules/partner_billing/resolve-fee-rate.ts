import { parsePlatformFeeBps, type FeeBasis } from "./compute-fee"

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
   * The partner the order is being accrued for. Reserved for the future
   * per-partner override lookup; ignored today (overrides are a later slice).
   */
  partnerId?: string | null
}

/**
 * Resolve the commission rate for a partner's order.
 *
 * Today: the platform default from `PLATFORM_TX_FEE_BPS` (200 = 2%), percentage
 * basis. Per-partner overrides are deferred (no `partner_fee_config` model yet);
 * when they land, query the override here and pass it to `pickFeeRate`.
 */
export async function resolvePartnerFeeRate(
  _container: any,
  _opts: ResolvePartnerFeeRateOpts = {}
): Promise<ResolvedFeeRate> {
  const defaultBps = parsePlatformFeeBps(
    process.env.PLATFORM_TX_FEE_BPS,
    PLATFORM_DEFAULT_FEE_BPS
  )
  // Override resolution intentionally deferred (#336: "per-partner override later").
  const overrideBps: number | null = null
  return pickFeeRate(overrideBps, defaultBps)
}
