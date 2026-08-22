import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import { PARTNER_ONBOARDING_PROFILE_MODULE } from "../../modules/partner-onboarding-profile"
import {
  buildProvenance,
  type Provenance,
  type ProvenanceFacts,
} from "./build-provenance"

/**
 * Fetch the facts `buildProvenance` shapes, for one quote (#1439 S9).
 *
 * The shaper has existed and been fully unit-tested since #1389 S2 and was
 * imported by nothing. This is the missing half: it reads the three records —
 * `partner`, `partner_onboarding_profile`, `artisan_product_detail` — and hands
 * them over. It decides NOTHING about what a buyer sees; that is
 * `build-provenance.ts`, and in particular its exclusion list is the security
 * boundary. Do not shape rows here.
 *
 * ## Never throws
 *
 * Same contract as `resolveQuoteProducer`: provenance is enrichment, and a
 * maker credit has no business turning a buyer's quote page into a 500. Every
 * failure — no partner, no profile, a query that fell over — collapses to
 * `null`, which the page reads as "say nothing".
 *
 * ## A basket has many products, and only ONE maker section
 *
 * The partner half is quote-level, so it is unambiguous. The product half is
 * not: a basket can mix a made-to-order shawl with a stocked scarf, and
 * printing the shawl's 21-day lead time over the whole quote is a claim about
 * items it was never made about. So the product facts are reduced to what every
 * quoted product AGREES on (`consensusArtisanDetail`) and the rest is dropped.
 * A single-product quote — the common case — therefore keeps everything.
 */

/** The subset of `artisan_product_detail` that provenance reads. */
export type ArtisanDetailFacts = NonNullable<ProvenanceFacts["artisan_detail"]>

/**
 * PURE: the product facts that hold for the WHOLE basket.
 *
 * A field survives only when every detail row that has an opinion agrees, and
 * only when every quoted product HAS a detail row — a product with no row is a
 * product we know nothing about, and an unanimous "21 days" across two of three
 * items is still a false statement about the third.
 *
 * 🔑 Absent ⇒ absent. This never falls back to the first line: silently
 * attributing one product's maker story to a mixed basket is exactly the
 * misattribution the omit-don't-em-dash rule exists to prevent.
 */
export function consensusArtisanDetail(
  details: Array<ArtisanDetailFacts | null | undefined>,
  productCount: number
): ArtisanDetailFacts | null {
  const present = details.filter(Boolean) as ArtisanDetailFacts[]
  if (!present.length) return null
  // One product with no detail row at all ⇒ nothing is basket-wide.
  if (productCount > 0 && present.length !== productCount) return null

  const agreed = <K extends keyof ArtisanDetailFacts>(
    key: K
  ): ArtisanDetailFacts[K] | null => {
    const values = present.map((d) => d?.[key] ?? null)
    const first = values[0]
    // `null` counts as an opinion here: "made to order" on one item and unset
    // on another is a disagreement, not a default.
    return values.every((v) => v === first) ? (first as any) : null
  }

  return {
    maker_story: agreed("maker_story"),
    lead_time_days: agreed("lead_time_days"),
    lead_time_label: agreed("lead_time_label"),
    min_order_quantity: agreed("min_order_quantity"),
    made_to_order: agreed("made_to_order"),
  }
}

/** PURE: is there anything here worth rendering a section for? */
export function hasProvenance(p: Provenance | null | undefined): boolean {
  return Boolean(p && (p.rows.length > 0 || p.maker_story))
}

export async function resolveQuoteProvenance(
  scope: any,
  input: { partner_id?: string | null; product_ids?: Array<string | null> }
): Promise<Provenance | null> {
  if (!input.partner_id) return null

  try {
    const query: any = scope.resolve(ContainerRegistrationKeys.QUERY)

    // Filtered by id, always. An unfiltered partner read on a public,
    // unauthenticated route is how one dangling key took every storefront
    // down (#1397).
    const { data: partners } = await query.graph({
      entity: "partners",
      fields: [
        "id",
        "name",
        "handle",
        "country_code",
        "is_verified",
        "workspace_type",
        "status",
      ],
      filters: { id: input.partner_id },
    })

    const partner = ((partners ?? []) as any[])[0]
    /**
     * Only `inactive` is silent — deliberately NOT the producer band's
     * "active or nothing" rule.
     *
     * 🔑 `pending` is the DEFAULT status of every partner the registration
     * route creates, and nothing about minting a quote requires an admin to
     * have flipped it. Refusing pending would have made this section render
     * for almost nobody — a feature that is present, green and invisible,
     * which is the exact condition #1448 exists to end. Caught by the
     * integration run: the fixture partner mints a perfectly good quote and
     * lands on `pending`.
     *
     * A disabled partner is different: their credentials are withdrawn, so
     * they are not shown. And the one row that is an actual CLAIM — "Verified
     * supplier" — is gated on `is_verified` inside the shaper, never on this.
     */
    if (!partner || partner.status === "inactive") return null

    let profile: any = null
    try {
      const onboarding: any = scope.resolve(PARTNER_ONBOARDING_PROFILE_MODULE)
      profile = await onboarding.findByPartner(input.partner_id)
    } catch {
      // A partner who never finished onboarding still has a name and a
      // country. Losing the profile half costs rows, not the section.
      profile = null
    }

    const productIds = [...new Set((input.product_ids ?? []).filter(Boolean))] as string[]
    let artisanDetail: ArtisanDetailFacts | null = null
    if (productIds.length) {
      // 🔑 Only ever with a non-empty id list. `filters: { id: [] }` /
      // `undefined` is NO FILTER, not "no rows" (#1433) — here that would
      // read every artisan detail row in the database.
      const { data: products } = await query.graph({
        entity: "product",
        // The product-side alias is the linked MODEL name; `artisan_detail.*`
        // silently returns nothing (see links/product-artisan-detail.ts).
        fields: ["id", "artisan_product_detail.*"],
        filters: { id: productIds },
      })
      artisanDetail = consensusArtisanDetail(
        ((products ?? []) as any[]).map((p) => p?.artisan_product_detail ?? null),
        productIds.length
      )
    }

    const provenance = buildProvenance({
      partner: {
        name: partner.name ?? null,
        handle: partner.handle ?? null,
        country_code: partner.country_code ?? null,
        is_verified: partner.is_verified ?? null,
        workspace_type: partner.workspace_type ?? null,
      },
      onboarding_profile: profile
        ? {
            what_they_sell: profile.what_they_sell ?? null,
            person_type: profile.person_type ?? null,
            team_size: profile.team_size ?? null,
            does_weaving: profile.does_weaving ?? null,
            does_stock: profile.does_stock ?? null,
          }
        : null,
      artisan_detail: artisanDetail,
    })

    // A heading over an empty list is worse than no section at all.
    return hasProvenance(provenance) ? provenance : null
  } catch {
    return null
  }
}
