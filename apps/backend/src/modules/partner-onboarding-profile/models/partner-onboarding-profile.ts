import { model } from "@medusajs/framework/utils"

/**
 * Partner onboarding profile (issue #648, slice 1).
 *
 * Captures the post-registration onboarding questionnaire answers for a
 * partner. One row per partner (`partner_id` is unique). Typed columns —
 * NOT a metadata blob — because these answers are load-bearing for partner
 * segmentation, fulfilment routing and the future KYC / payment-config
 * slices (see feedback_no_critical_data_in_metadata).
 */
const PartnerOnboardingProfile = model.define("partner_onboarding_profile", {
  id: model.id().primaryKey(),
  // The partner this profile belongs to. Unique — one profile per partner.
  partner_id: model.text().unique(),

  // 1. What the partner sells (broad textile category).
  what_they_sell: model
    .enum(["apparel", "home_textiles", "fabric", "yarn", "accessories", "other"])
    .nullable(),

  // 2. Typical price band of their products.
  price_range: model.enum(["economy", "mid", "premium", "luxury"]).nullable(),

  // 3. Do they keep structured inventory information?
  has_inventory_info: model.boolean().nullable(),

  // 4. Do they hold / carry stock themselves?
  does_stock: model.boolean().nullable(),

  // 5. Do they do weaving in-house?
  does_weaving: model.boolean().nullable(),

  // 6. The kind of entity the partner is.
  person_type: model
    .enum([
      "individual",
      "business",
      "manufacturer",
      "wholesaler",
      "retailer",
      "artisan",
      "other",
    ])
    .nullable(),

  // 7. How many people work in the partner's team.
  team_size: model.number().nullable(),

  // 8. Who collects customer payments — JYT ("through_us") or the partner
  //    themselves. This only RECORDS the choice; the actual payment wiring
  //    lives in /partners/payment-config (out of scope for slice 1).
  payment_collection: model.enum(["through_us", "themselves"]).nullable(),

  // 9. How the partner wants to sell (#859 S1 / #860):
  //    - dedicated_storefront: runs their own storefront/sales channel.
  //    - core_channel_listing: Airbnb-style listing on the core cicilabel.com
  //      sales channel, at an agreed commission (see commission_bps).
  selling_mode: model
    .enum(["dedicated_storefront", "core_channel_listing"])
    .nullable(),

  // 10. Agreed commission / revenue-share, in basis points (1000 = 10.00%).
  //     Nullable — when unset the platform default (PLATFORM_TX_FEE_BPS, 2%)
  //     applies. Wired into partner_billing/resolve-fee-rate as the per-partner
  //     override (#336 override slot).
  commission_bps: model.number().nullable(),

  // Set true once the partner submits the wizard.
  completed: model.boolean().default(false),

  metadata: model.json().nullable(),
})

export default PartnerOnboardingProfile
