/**
 * Who made this, and how — shaped once, rendered by both the quote page and
 * the quote email (#1389 S2).
 *
 * A pure shaper in the spirit of `production-story-lib/build-story.ts`: it takes
 * already-fetched facts and returns `rows[]`. Page and email render the same
 * array, so neither of them decides what the facts ARE.
 *
 * ## The facts come from two levels, and both halves are needed
 *
 * - **Partner-level, structured**: `partner` (identity, country, verification)
 *   and `partner_onboarding_profile` (what they make, who they are, team size,
 *   whether they weave in-house).
 * - **Product-level, prose**: `artisan_product_detail.maker_story`.
 *
 * The partner row has no story or location prose of its own. Do not add one in
 * v1 — a second free-text field about the same maker is a field that will
 * disagree with the first.
 *
 * ## PUBLIC-SAFE, and that is a hard boundary
 *
 * A business buyer sees this. It carries NO commercial terms and NO legal
 * identifiers: `commission_bps`, `payment_collection`, `selling_mode`,
 * `supplies_to_platform`, `tax_id` and `tax_id_type` are all deliberately
 * absent. `price_range` is absent too — a buyer negotiating a bulk price should
 * not be shown the band we filed the partner under.
 *
 * Adding a field here publishes it. Anything commercially sensitive belongs on
 * the admin or partner surfaces, which already own that view.
 *
 * ⚠️ This is NOT a detail-band block source. Wiring it into the band would mean
 * four synchronized edits across two repos — `detail-band/resolve.ts`, the
 * backend's `resolve-detail-band.ts`, the labels/availability tables in both,
 * and the theme-editor picker — for something that only ever renders on a quote
 * page. The quote page owns a self-contained section instead. If provenance
 * later wants to be on every product page, that is the moment to delete the
 * hand-sync and have the backend return the resolved band — not to extend it.
 */

export type ProvenanceRow = {
  /** Stable machine key, so the renderers can style or reorder without parsing labels. */
  key: string
  label: string
  value: string
  /** Which record the fact came from — an unattributed fact is a claim. */
  source: "partner" | "partner-onboarding-profile" | "artisan-product-detail"
}

export type ProvenanceFacts = {
  partner?: {
    name?: string | null
    handle?: string | null
    country_code?: string | null
    is_verified?: boolean | null
    workspace_type?: string | null
  } | null
  onboarding_profile?: {
    what_they_sell?: string | null
    person_type?: string | null
    team_size?: number | null
    does_weaving?: boolean | null
    does_stock?: boolean | null
  } | null
  artisan_detail?: {
    maker_story?: string | null
    lead_time_days?: number | null
    lead_time_label?: string | null
    min_order_quantity?: number | null
    made_to_order?: boolean | null
  } | null
}

export type Provenance = {
  maker_name: string | null
  /** Free prose, rendered as a paragraph rather than a row. */
  maker_story: string | null
  rows: ProvenanceRow[]
}

const TITLE_CASE = (value: string): string =>
  value
    .split("_")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ")

// ISO country codes a buyer would rather read as a name. Deliberately short:
// an unknown code falls through as the code itself, which is honest, rather
// than being dropped or guessed at.
const COUNTRY_NAMES: Record<string, string> = {
  IN: "India",
  GB: "United Kingdom",
  US: "United States",
  DE: "Germany",
  FR: "France",
  AE: "United Arab Emirates",
  AU: "Australia",
  CA: "Canada",
}

/**
 * PURE: shape the facts into rows.
 *
 * Every row is omitted when its fact is absent. An empty row with an em-dash
 * reads as "we know this and it is nothing", which is a different and wrong
 * claim — a buyer assessing a supplier should see gaps as gaps.
 */
export function buildProvenance(facts: ProvenanceFacts): Provenance {
  const rows: ProvenanceRow[] = []
  const partner = facts.partner ?? null
  const profile = facts.onboarding_profile ?? null
  const detail = facts.artisan_detail ?? null

  if (partner?.name) {
    rows.push({
      key: "maker",
      label: "Made by",
      value: partner.name,
      source: "partner",
    })
  }

  const code = String(partner?.country_code || "").toUpperCase()
  if (code) {
    rows.push({
      key: "country",
      label: "Made in",
      value: COUNTRY_NAMES[code] ?? code,
      source: "partner",
    })
  }

  if (partner?.is_verified) {
    // Only ever stated when true. "Verified: no" is an accusation, not a fact.
    rows.push({
      key: "verified",
      label: "Verified supplier",
      value: "Identity verified by Jaal Yantra Textiles",
      source: "partner",
    })
  }

  if (profile?.person_type) {
    rows.push({
      key: "maker_type",
      label: "Maker type",
      value: TITLE_CASE(profile.person_type),
      source: "partner-onboarding-profile",
    })
  }

  if (profile?.what_they_sell) {
    rows.push({
      key: "specialises_in",
      label: "Specialises in",
      value: TITLE_CASE(profile.what_they_sell),
      source: "partner-onboarding-profile",
    })
  }

  if (typeof profile?.team_size === "number" && profile.team_size > 0) {
    rows.push({
      key: "team_size",
      label: "Team size",
      value:
        profile.team_size === 1
          ? "1 person"
          : `${profile.team_size} people`,
      source: "partner-onboarding-profile",
    })
  }

  if (profile?.does_weaving) {
    rows.push({
      key: "weaving",
      label: "Weaving",
      value: "Woven in-house",
      source: "partner-onboarding-profile",
    })
  }

  if (detail?.made_to_order) {
    rows.push({
      key: "made_to_order",
      label: "Production",
      value: "Made to order",
      source: "artisan-product-detail",
    })
  }

  // The partner's own words beat a derived number, which is why the label is
  // checked first; the day count is the fallback, not the preference.
  const leadTime =
    detail?.lead_time_label ||
    (typeof detail?.lead_time_days === "number" && detail.lead_time_days > 0
      ? `${detail.lead_time_days} day${detail.lead_time_days === 1 ? "" : "s"}`
      : null)
  if (leadTime) {
    rows.push({
      key: "lead_time",
      label: "Lead time",
      value: leadTime,
      source: "artisan-product-detail",
    })
  }

  if (
    typeof detail?.min_order_quantity === "number" &&
    detail.min_order_quantity > 1
  ) {
    // A minimum of 1 is not a minimum, and printing it invites the buyer to
    // wonder what the catch is.
    rows.push({
      key: "min_order_quantity",
      label: "Minimum order",
      value: `${detail.min_order_quantity} units`,
      source: "artisan-product-detail",
    })
  }

  const story = String(detail?.maker_story ?? "").trim()

  return {
    maker_name: partner?.name ?? null,
    maker_story: story || null,
    rows,
  }
}
