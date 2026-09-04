import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"

/**
 * Which region a quote belongs to (#1787).
 *
 * ## The defect this closes
 *
 * `region_id` is optional on the mint and nothing ever derived it. The admin
 * wizard has a selector; the MCP tool does not ask, its guidance never mentions
 * a region, and the word appears three times in the whole mint tool schema. So
 * a caller who says "Australia, in AUD" sends `destination_country_code: "AU"`
 * and `currency_code: "aud"` — both of which name exactly one region — and the
 * quote is stored with none.
 *
 * At accept, `quote.region_id ?? store.default_region_id` then sent the cart to
 * the store default: **India / INR**. Payment providers are configured per
 * region, so an Australian buyer holding an AUD 314.77 quote was offered PayU,
 * an INR-only rail, and never Stripe. The buyer reported it as "I cannot pay".
 *
 * ## Why derive rather than default
 *
 * The store default is right for a domestic INR quote and actively wrong for
 * every foreign-currency one — and wrong in a way nothing downstream notices,
 * because a region mismatch produces no error, just the wrong gateway.
 *
 * A quote's currency and destination are not hints: `currency_code` is already
 * documented to the caller as "must match the region's currency", a rule stated
 * and never enforced. This enforces it.
 */

export type RegionLike = {
  id: string
  currency_code?: string | null
  countries?: Array<{ iso_2?: string | null }> | null
}

export type RegionResolution =
  | { region_id: string; source: "explicit" | "derived" }
  | { region_id: null; source: "none"; reason: string }

const lower = (v: unknown): string => String(v ?? "").trim().toLowerCase()

/**
 * PURE. Pick the region for a quote, or explain why none can be picked.
 *
 * An explicit `region_id` wins, but only if it is real AND its currency agrees
 * with the quote's — a quote priced in one currency inside a region denominated
 * in another is the same class of mismatch, just supplied by hand.
 *
 * Otherwise: the region whose currency matches AND whose countries include the
 * destination. Both conditions, never either — currency alone would pick the
 * wrong one the moment two regions share a currency (eur, most obviously), and
 * country alone would ignore what the buyer was actually quoted in.
 *
 * **Ambiguity is not resolved by picking the first.** More than one match means
 * a human configured two regions that both claim this sale, and guessing which
 * is how a quote ends up on the wrong books.
 */
export function pickQuoteRegion(
  regions: RegionLike[],
  input: {
    region_id?: string | null
    currency_code?: string | null
    destination_country_code?: string | null
  }
): RegionResolution {
  const all = Array.isArray(regions) ? regions : []
  const currency = lower(input.currency_code)
  const country = lower(input.destination_country_code)

  if (input.region_id) {
    const named = all.find((r) => r.id === input.region_id)
    if (!named) {
      return {
        region_id: null,
        source: "none",
        reason: `region_id ${input.region_id} does not exist`,
      }
    }
    const named_currency = lower(named.currency_code)
    if (currency && named_currency && named_currency !== currency) {
      return {
        region_id: null,
        source: "none",
        reason:
          `region ${named.id} is denominated in ${named_currency}, ` +
          `but the quote is priced in ${currency}`,
      }
    }
    return { region_id: named.id, source: "explicit" }
  }

  if (!currency || !country) {
    return {
      region_id: null,
      source: "none",
      reason: "no region_id, and no currency + destination to derive one from",
    }
  }

  const matches = all.filter(
    (r) =>
      lower(r.currency_code) === currency &&
      (r.countries ?? []).some((c) => lower(c?.iso_2) === country)
  )

  if (matches.length === 1) {
    return { region_id: matches[0].id, source: "derived" }
  }
  if (matches.length > 1) {
    return {
      region_id: null,
      source: "none",
      reason:
        `${matches.length} regions claim ${currency.toUpperCase()} + ` +
        `${country.toUpperCase()} (${matches.map((m) => m.id).join(", ")}) — ` +
        `name one with region_id`,
    }
  }
  return {
    region_id: null,
    source: "none",
    reason: `no region covers ${currency.toUpperCase()} + ${country.toUpperCase()}`,
  }
}

/**
 * Container-driven wrapper: read the regions, then decide.
 *
 * `strict` is the mint's posture — a quote is a commercial commitment, and one
 * frozen against the wrong region checks out through the wrong country's
 * gateway. Better to refuse at mint, where the partner is present, than at
 * accept, where the buyer is.
 *
 * Accept passes `strict: false`: those quotes are already minted, so the belt
 * improves what it can and leaves the caller's own fallback in place.
 */
export async function resolveQuoteRegion(
  scope: any,
  input: {
    region_id?: string | null
    currency_code?: string | null
    destination_country_code?: string | null
  },
  opts: { strict?: boolean } = {}
): Promise<RegionResolution> {
  const query = scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data: regions } = await query.graph({
    entity: "region",
    fields: ["id", "currency_code", "countries.iso_2"],
  })

  const resolved = pickQuoteRegion((regions ?? []) as RegionLike[], input)

  /**
   * 🔴 Narrow on `source`, not on `!region_id`.
   *
   * `RegionResolution` is a union whose failure branch is the only one carrying
   * `reason`, and `source` is its discriminant. TypeScript narrows a union by
   * truthiness only when the property is a literal type — `region_id: string`
   * is not, so `!resolved.region_id` narrowed nothing and `resolved.reason`
   * did not compile. That failed CI's `prod-build` job on every push, on `main`
   * included, from the moment #1788 landed.
   */
  if (opts.strict && resolved.source === "none") {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `Cannot determine the region for this quote: ${resolved.reason}. ` +
        `The region decides which payment providers the buyer is offered, so a ` +
        `quote must not be frozen without one.`
    )
  }

  return resolved
}
