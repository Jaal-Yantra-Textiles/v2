/**
 * Which country a request routes to — including when the region map is EMPTY
 * (#1993).
 *
 * ## The failure this exists for
 *
 * `getRegionMap` fetches `/store/regions` to build a country→region map, and on
 * failure it rethrew whenever it had no cache to fall back on. A WARM instance
 * survives on its stale in-process cache; a COLD one — just deployed, just
 * restarted, or just scaled up — has none, so the rethrow became a **500 on
 * every single route**. Home, catalogue, checkout, payment links, all of it.
 *
 * That is the other half of the #1985 incident. PR #1992 taught the payment
 * page to tell a buyer the truth — "our side is not responding, your link is
 * fine" — but that page only renders if middleware lets the request through.
 * On a cold instance the buyer got a bare 500 and never saw it.
 *
 * ## 🔑 The two failures that look identical and must not be treated alike
 *
 * - **Unreachable** — the fetch failed, timed out, or answered non-2xx. The
 *   backend is down or not deployed yet. Nothing about the STOREFRONT is
 *   wrong, and the honest response is to serve the site and let each page say
 *   what it cannot load. Degrading here is what makes #1992's work reachable.
 *
 * - **Unconfigured** — the backend answered fine and said there are zero
 *   regions. That is a real misconfiguration in Medusa Admin, by a developer,
 *   and it should stay LOUD. Degrading it to `DEFAULT_REGION` would route to
 *   `/us` and render empty pages forever with nobody told why.
 *
 * Collapsing the two is the easy mistake: both arrive as "the region map is
 * empty". They are distinguished at the throw site, not guessed at here.
 *
 * ## Why DEFAULT_REGION is not a new invention
 *
 * `pickCountryCode` already prefers `DEFAULT_REGION` over an arbitrary map key
 * when the map is healthy. Using it when the map is empty gives a visitor the
 * same answer they would have got from an unlisted country — it does not
 * introduce a new routing rule, it stops one from being unavailable.
 */

/** Tag carried by the "backend answered, and said zero regions" error. */
export const REGION_MAP_UNCONFIGURED = "REGION_MAP_UNCONFIGURED"

/**
 * Was this failure a real misconfiguration rather than an outage?
 *
 * Checked on a `name` we set ourselves rather than by matching the message:
 * a message is prose, it gets reworded, and the reword would silently turn a
 * loud misconfiguration into a quiet redirect to `/us`.
 */
export function isUnconfiguredRegionsError(error: unknown): boolean {
  return (error as { name?: string } | null)?.name === REGION_MAP_UNCONFIGURED
}

export type CountryCodePick = {
  countryCode?: string
  /**
   * True when the pick was made with NO region map — the site is being served
   * on a fallback and pages should not present region-dependent data as if it
   * were confirmed.
   */
  degraded: boolean
}

/**
 * Pick the country to route to.
 *
 * With a populated map the precedence is unchanged: an explicit country in the
 * URL, then the Vercel geo header, then `DEFAULT_REGION`, then — last resort —
 * whatever key the map yields first.
 *
 * ⚠️ That last resort is an arbitrary-first-row read, the same shape as the
 * `take: 1` bugs this codebase keeps finding. It is left alone here because
 * changing it is a separate decision about a separate case; it only fires when
 * the map is populated but contains neither the requested country nor the
 * default.
 *
 * With an EMPTY map there is nothing to validate against, so the URL's own
 * country code is honoured if it looks like one — a buyer returning to
 * `/gb/order/confirmed` should land where they were, not be bounced to `/us` —
 * and otherwise `DEFAULT_REGION` is used. Both are marked `degraded`.
 */
export function pickCountryCode(args: {
  urlCountryCode?: string
  vercelCountryCode?: string
  regionMap: Map<string, unknown>
  defaultRegion?: string
}): CountryCodePick {
  const { urlCountryCode, vercelCountryCode, regionMap } = args
  const defaultRegion = args.defaultRegion?.toLowerCase() || undefined

  const mapIsEmpty = regionMap.size === 0

  if (!mapIsEmpty) {
    if (urlCountryCode && regionMap.has(urlCountryCode)) {
      return { countryCode: urlCountryCode, degraded: false }
    }
    if (vercelCountryCode && regionMap.has(vercelCountryCode)) {
      return { countryCode: vercelCountryCode, degraded: false }
    }
    if (defaultRegion && regionMap.has(defaultRegion)) {
      return { countryCode: defaultRegion, degraded: false }
    }
    const first = regionMap.keys().next().value as string | undefined
    return { countryCode: first, degraded: false }
  }

  // Empty map: nothing to validate against, so "looks like a country code" is
  // the only test available. Two letters — anything else is a path segment
  // (`products`, `cart`) that must NOT be mistaken for a country, or the
  // buyer's URL gets rewritten into nonsense.
  if (urlCountryCode && /^[a-z]{2}$/.test(urlCountryCode)) {
    return { countryCode: urlCountryCode, degraded: true }
  }
  if (vercelCountryCode && /^[a-z]{2}$/.test(vercelCountryCode)) {
    return { countryCode: vercelCountryCode, degraded: true }
  }
  return { countryCode: defaultRegion, degraded: true }
}
