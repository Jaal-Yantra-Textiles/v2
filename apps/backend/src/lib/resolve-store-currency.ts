import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

/**
 * #485 — multi-store currency resolution.
 *
 * The deployment is multi-store (one platform store + one store per partner).
 * The historical `stores[0]` pattern resolves the platform store (default
 * currency EUR) for EVERY currency decision, so partner work-orders /
 * design references get stamped EUR instead of the partner's own currency
 * (INR). This helper centralises currency resolution so call sites can ask for
 * "the partner's store currency" when a partner is in context, falling back to
 * the platform/base store otherwise.
 *
 * See apps/docs/notes/485_PARTNER_CURRENCY_EUR_ROOT_CAUSE.md.
 */

/** Minimal shape of a store as returned by `query.graph` with supported_currencies expanded. */
export type StoreCurrencyShape = {
  supported_currencies?: Array<{
    currency_code?: string | null
    is_default?: boolean | null
  } | null> | null
}

/**
 * Pure: pick a store's default currency code (the supported currency flagged
 * `is_default`), lower-cased. Returns `fallback` when the store is missing, has
 * no supported currencies, or none is flagged default. Exported for unit
 * testing — keeps the selection verifiable without booting the DB.
 */
export function pickDefaultCurrency(
  store: StoreCurrencyShape | null | undefined,
  fallback = "inr"
): string {
  const code = store?.supported_currencies?.find((c) => c?.is_default)?.currency_code
  return (code ?? fallback).toLowerCase()
}

export type ResolveStoreCurrencyOpts = {
  /**
   * When provided, resolve the currency of the partner's linked store. Falls
   * back to the platform/base store currency when the partner has no store or
   * no default currency.
   */
  partnerId?: string | null
  /** Returned when no store/currency can be resolved at all (default "inr"). */
  fallback?: string
}

/**
 * Resolve the currency code that should denominate work in the given context.
 *
 * - With `partnerId`: the partner's linked store default currency (the correct
 *   denomination for partner work-orders / design references). Falls through to
 *   the platform/base store when the partner has no usable store currency.
 * - Without `partnerId`: the platform/base store default currency (the first
 *   store — preserves the historical behaviour for partner-less contexts such
 *   as inventory orders created admin-side before a partner is linked).
 *
 * Drop-in replacement for the `stores[0].supported_currencies[is_default]`
 * pattern. Never throws — currency resolution is best-effort and always returns
 * a usable code.
 */
export async function resolveStoreCurrency(
  container: any,
  opts: ResolveStoreCurrencyOpts = {}
): Promise<string> {
  const { partnerId, fallback = "inr" } = opts
  const query: any = container.resolve(ContainerRegistrationKeys.QUERY)

  if (partnerId) {
    try {
      const { data } = await query.graph({
        entity: "partners",
        // `stores.supported_currencies.*` MUST be expanded so the default-flag
        // is present on the returned currencies (see api/partners/helpers.ts).
        fields: ["id", "stores.supported_currencies.*"],
        filters: { id: partnerId },
      })
      const partnerStore = data?.[0]?.stores?.[0]
      const code = partnerStore?.supported_currencies?.find(
        (c: any) => c?.is_default
      )?.currency_code
      if (code) return String(code).toLowerCase()
    } catch {
      // fall through to the platform/base store
    }
  }

  try {
    const { data: stores } = await query.graph({
      entity: "store",
      fields: ["supported_currencies.*"],
    })
    return pickDefaultCurrency(stores?.[0], fallback)
  } catch {
    return fallback.toLowerCase()
  }
}
