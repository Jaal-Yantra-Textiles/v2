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

/* -------------------------------------------------------------------------- *
 * Storefront (publishable-key) currency resolution
 * -------------------------------------------------------------------------- */

/**
 * Minimal shape of a store row as needed to pick the storefront's currency.
 * `default_sales_channel_id` is a scalar column on the core Store model;
 * `supported_currencies` is a hasMany and must be requested explicitly — a
 * `fields: ["*"]` selection does NOT expand it, which is why this module runs
 * its own query instead of reusing `getStoreFromPublishableKey`.
 */
export type StorefrontStoreShape = StoreCurrencyShape & {
  id?: string | null
  default_sales_channel_id?: string | null
}

/**
 * PURE: the store's default currency, or `null` when the store cannot name one.
 *
 * Deliberately NOT `pickDefaultCurrency`, which always hands back a fallback.
 * On a money path "I don't know" must stay distinguishable from a currency, so
 * this one returns null — and it treats a blank code as absent, because `""`
 * survives a `??` guard and would otherwise denominate a price as nothing.
 */
export function pickStorefrontCurrency(
  store: StoreCurrencyShape | null | undefined
): string | null {
  const code = store?.supported_currencies?.find((c) => c?.is_default)
    ?.currency_code
  const trimmed = typeof code === "string" ? code.trim() : ""
  return trimmed ? trimmed.toLowerCase() : null
}

/**
 * PURE: the store the publishable key speaks for — the one whose DEFAULT sales
 * channel the key grants.
 *
 * Returns null when the key grants no channel, when no store claims one, **and
 * when more than one store claims one**. Two stores sharing a default channel
 * is a data fault, and answering it with `stores[0]` is precisely the selector
 * bug this function exists to remove: it would be right for whichever row came
 * back first and silently wrong for the rest.
 */
export function pickStoreForSalesChannels<T extends StorefrontStoreShape>(
  stores: T[] | null | undefined,
  salesChannelIds: string[] | null | undefined
): T | null {
  const granted = new Set((salesChannelIds ?? []).filter(Boolean))
  if (!granted.size) return null
  const matches = (stores ?? []).filter(
    (s) => s?.default_sales_channel_id && granted.has(s.default_sales_channel_id)
  )
  return matches.length === 1 ? matches[0] : null
}

/**
 * Resolve the base currency of the storefront making this request.
 *
 * 🔴 Replaces the `stores[0]` pattern on the public design estimate/checkout
 * routes. The deployment runs 14 stores; `stores[0]` is the platform store
 * (EUR) while most partner storefronts are INR, so every partner storefront's
 * cost estimate was denominated EUR and then converted EUR→INR at the till —
 * inflating the price by the exchange rate, roughly 100x.
 *
 * The publishable key is the tenant signal: `/store/*` cannot be reached
 * without a valid one (the framework's `ensurePublishableApiKeyMiddleware` runs
 * for the whole namespace), so `req.publishable_key_context` is always present
 * in a handler.
 *
 * Returns **null** rather than a fallback literal. A caller on a money path
 * must refuse; inventing a denomination is how the two routes came to disagree
 * by ~100x in the first place (one defaulted "eur", the other "inr").
 */
export async function resolveStorefrontCurrency(
  container: any,
  publishableKeyContext: { sales_channel_ids?: string[] | null } | null | undefined
): Promise<string | null> {
  const salesChannelIds = publishableKeyContext?.sales_channel_ids
  if (!salesChannelIds?.length) return null

  try {
    const query: any = container.resolve(ContainerRegistrationKeys.QUERY)
    const { data: stores } = await query.graph({
      entity: "store",
      filters: { default_sales_channel_id: salesChannelIds },
      fields: [
        "id",
        "default_sales_channel_id",
        "supported_currencies.currency_code",
        "supported_currencies.is_default",
      ],
    })
    return pickStorefrontCurrency(
      pickStoreForSalesChannels(stores as StorefrontStoreShape[], salesChannelIds)
    )
  } catch {
    // An unresolvable store is not a cheap store. Say "unknown" and let the
    // caller refuse.
    return null
  }
}
