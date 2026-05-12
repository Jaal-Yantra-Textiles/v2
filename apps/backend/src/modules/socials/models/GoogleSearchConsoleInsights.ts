import { model } from "@medusajs/framework/utils"
import GoogleSearchConsoleSite from "./GoogleSearchConsoleSite"

/**
 * GoogleSearchConsoleInsights
 *
 * Daily Search Analytics rows from the GSC API. One row per
 * (site, date, query, page, country, device) tuple — any dimension can be
 * null when GSC returns an aggregate row (e.g. "no query specified" /
 * anonymized queries).
 *
 * Why a single denormalized table: GSC's Search Analytics endpoint returns
 * exactly this shape per request; we'd just be re-fanning the same row
 * into multiple narrower tables and losing the ability to answer cross-
 * dimension questions ("which page did query X land on for users in DE
 * on mobile"). 5,000 rows / site / day keeps storage linear and the
 * indexes small.
 */
const GoogleSearchConsoleInsights = model.define(
  "GoogleSearchConsoleInsights",
  {
    id: model.id().primaryKey(),

    // Period — Search Analytics is always per-day for this sync.
    date: model.text(), // YYYY-MM-DD

    // Dimensions — any subset may be present per row, depending on the
    // sync's `dimensions` array. Default sync sets all five.
    query: model.text().searchable().nullable(),
    page: model.text().searchable().nullable(),
    country: model.text().nullable(), // ISO 3166-1 alpha-3 (per GSC)
    device: model.text().nullable(), // DESKTOP | MOBILE | TABLET
    search_appearance: model.text().nullable(), // AMP_TOP_STORIES, RICH_RESULTS, etc.

    // Metrics
    clicks: model.bigNumber().default(0),
    impressions: model.bigNumber().default(0),
    ctr: model.float().nullable(), // 0..1 (Google's native range — not %)
    position: model.float().nullable(), // average position

    // Relationships
    site: model.belongsTo(() => GoogleSearchConsoleSite, {
      mappedBy: "insights",
    }),

    // Audit
    raw: model.json().nullable(),
    synced_at: model.dateTime(),
  }
).indexes([
  {
    on: ["date"],
    name: "idx_google_search_console_insights_date",
  },
])

export default GoogleSearchConsoleInsights
