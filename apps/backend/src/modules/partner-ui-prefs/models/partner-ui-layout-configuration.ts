import { model } from "@medusajs/framework/utils"

/**
 * Partner UI layout configuration (#338 — menu/submenu personalization).
 *
 * The partner-scoped mirror of Medusa core's admin `layout_configuration`. It
 * backs the LayoutComposer (ported from investor-ui, whose persistence was
 * stubbed): per-zone widget placement/visibility so a partner can hide unused
 * modules, reorder the sidebar, etc.
 *
 * Data contract matches the composer's `LayoutPreference`:
 *   configuration = { widgets: Record<widgetId, { hidden?, order?, section? }> }
 *
 * Scope (mirrors the composer's personal/default split):
 *   - is_default = false → the partner's personal override (what they edited).
 *   - is_default = true  → the zone's default for the partner, seeded from the
 *     persona template (designer/seller/…). Personal wins over default at read.
 *
 * NOTE: the partner IS the auth actor here (auth_context.actor_id = partner_id;
 * there is no separate per-admin-user identity on partner auth), so scoping is
 * per-partner, not per-user. The is_default axis is what distinguishes a
 * partner's own edit from the persona-seeded default.
 *
 * One row per (partner_id, zone, is_default) — enforced by the compound unique
 * index below.
 */
const PartnerUiLayoutConfiguration = model
  .define("partner_ui_layout_configuration", {
    id: model.id().primaryKey(),

    // The partner this configuration belongs to.
    partner_id: model.text().searchable(),

    // The layout zone / widgets-zone-prefix this configures, e.g.
    // "sidebar.main", "home", "product.list".
    zone: model.text(),

    // Scope discriminator — see the model doc-comment.
    is_default: model.boolean().default(false),

    // The composer's LayoutPreference blob: { widgets: { [id]: {...} } }.
    configuration: model.json(),

    metadata: model.json().nullable(),
  })
  .indexes([
    {
      on: ["partner_id", "zone", "is_default"],
      unique: true,
    },
  ])

export default PartnerUiLayoutConfiguration
