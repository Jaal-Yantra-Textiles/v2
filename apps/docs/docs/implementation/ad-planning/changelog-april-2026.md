---
title: "Ad Planning - Changelog (April 2026)"
sidebar_label: "Changelog (April)"
sidebar_position: 5
---

# Ad Planning Module — Changelog (April 2026)

Systematic audit and fix of 30+ logical bugs across workflows, API routes, models, subscribers, and scheduled jobs. Organized into three phases: critical data integrity, wrong numbers, and performance.

_Last updated: 2026-04-10_

---

## Phase 1: Critical Data Integrity

### Cross-Customer Attribution Leakage (CRITICAL)

**Bug**: `findAttributionStep` in `track-purchase-conversion.ts` fetched ALL resolved attributions system-wide and assigned the most recent one to the current order — leaking any random customer's ad campaign into unrelated purchases.

**Fix**: Scoped by looking up the person's historical visitor_ids from their `Conversion` records first, then filtering attributions to only those visitor_ids.

**File**: `src/workflows/ad-planning/conversions/track-purchase-conversion.ts`

### A/B Test p-Value Formula Broken (CRITICAL)

**Bug**: `calculatePValue` in `statistical-utils.ts` returned `p > 1` for negative z-scores. Any A/B test where treatment outperformed control was never declared statistically significant because `getSignificanceLevel` fell through all thresholds.

**Fix**: Rewrote to use symmetric two-tailed formula `p = 1 - erf(|z|/√2)` with `Math.max(0, Math.min(1, ...))` clamping.

**File**: `src/modules/ad-planning/utils/statistical-utils.ts`

### CampaignAttribution Platform Enum Missing "direct"

**Bug**: `CampaignAttribution` model only allowed `["meta", "google", "generic"]` with default `"meta"`. Every direct-traffic session and every unresolved attribution was tagged as Meta.

**Fix**: Added `"direct"` to enum, changed default from `"meta"` to `"direct"`. Updated all Zod validators and workflow step types to match.

**Files**: `campaign-attribution.ts`, `attribution/route.ts`, `track-conversion.ts`, `track-purchase-conversion.ts`, `track-lead-conversion.ts`
**Migration**: `Migration20260410033050.ts`

### Experiment Filter on Nonexistent Column

**Bug**: `GET /admin/ad-planning/experiments` filtered on `ad_campaign_id` which doesn't exist on the `ABExperiment` model. MikroORM would throw a DB error on every filtered request.

**Fix**: Replaced with `experiment_type` filter (a real column). Also switched to `listAndCountABExperiments` so `count` returns the total, not the page size.

**File**: `src/api/admin/ad-planning/experiments/route.ts`

### Recalculate Scores Job OOM Risk

**Bug**: Weekly job loaded ALL conversions and ALL customer journeys into memory with no pagination.

**Fix**: Added 30-day activity window filter, paginated fetch (500 rows/page), and concurrent processing (5 at a time with parallel score workflows per person).

**File**: `src/jobs/ad-planning/recalculate-scores-job.ts`

---

## Phase 2: Wrong Numbers

### Conversion Currency Default "INR"

**Bug**: `Conversion.currency` model field defaulted to `"INR"` regardless of store locale. Every EUR/USD/GBP conversion was silently tagged INR.

**Fix**: Changed to `nullable()`. Removed hardcoded `"INR"` fallbacks in `track-conversion.ts`, `track-purchase-conversion.ts`, and `track-lead-conversion.ts`. Callers now pass the real currency from the order or null.

**Migration**: Included in `Migration20260410035444.ts`

### Lead Conversion Platform Detection

**Bug**: `track-lead-conversion.ts` read `utm_campaign` (the campaign name) instead of `utm_source` (the traffic source) to detect platform. Since campaign names rarely contain "facebook" or "google", all leads were tagged `"generic"`.

**Fix**: Now reads `utm_source` first, falls back to `utm_campaign`. Added common aliases: `fb`, `ig`, `adwords`.

**File**: `src/workflows/ad-planning/conversions/track-lead-conversion.ts`

### Forecast Confidence Interval Formula Inverted

**Bug**: `forecasts/route.ts` used `(1 - (1 - confidenceLevel))` which simplifies to just `confidenceLevel`. Lower confidence produced tighter intervals (backwards).

**Fix**: `margin = 1 - confidenceLevel`, applied as `(1 ± margin)`.

**File**: `src/api/admin/ad-planning/forecasts/route.ts`

### Churn Risk Ignores "very_negative" Sentiment

**Bug**: `calculate-churn-risk.ts` only counted `sentiment_label === "negative"`. A customer with exclusively `"very_negative"` feedback had a negative sentiment ratio of 0.

**Fix**: Both `"negative"` (weight 1.0) and `"very_negative"` (weight 1.5) now contribute. Applied to both the standalone workflow and the inline copy in `track-purchase-conversion.ts`.

### NPS Scale-5 Rounding Bug

**Bug**: `normalizeRatingStep` used `Math.round((rating - 1) * 2.5)` which maps rating 4 to 8 instead of 7.5, flipping the NPS category from where it should be.

**Fix**: Classify from the raw 5-point rating directly (5 = promoter, 4 = passive, 1-3 = detractor) instead of rounding through the 0-10 scale. The stored `nps_value` still uses the linear mapping for cross-scale aggregation.

**File**: `src/workflows/ad-planning/scoring/calculate-nps.ts`

### Feedback Subscriber NPS Scale Boundary

**Bug**: `rating <= 5 ? "5" : "10"` — a 10-point scale rating of exactly 5 was misrouted to the 5-point scale calculation.

**Fix**: Changed to `< 6` with support for an explicit `scale` field on the event payload. Added top-level ID guard and try/catch.

**File**: `src/subscribers/ad-planning/feedback-created.ts`

### Analytics-Event Subscriber Try/Catch Scoping

**Bug**: Attribution resolution ran outside the main try/catch block, firing even when the conversion tracking above had thrown an error. The catch was also completely silent (no logging).

**Fix**: Moved inside the outer try/catch. Added intelligent error logging that suppresses duplicate-key errors (expected for unique index) but logs real failures.

**File**: `src/subscribers/ad-planning/analytics-event-created.ts`

### Bulk Attribution Exclusion Set Truncation

**Bug**: `listCampaignAttributions({})` with no pagination hit Medusa's default list limit. Beyond that limit, session IDs weren't in the exclusion set, causing duplicate attribution writes.

**Fix**: Scoped the query to only the candidate session IDs from the current batch, with explicit `take` matching the batch size.

**File**: `src/workflows/ad-planning/attribution/bulk-resolve-attributions.ts`

### Budget Forecast Duplicate Accumulation

**Bug**: `(ad_campaign_id, forecast_date)` index was not unique. Re-running the forecast job for the same campaign/date produced duplicate rows that inflated MAPE calculations.

**Fix**: Made the index unique.
**Migration**: `Migration20260410035444.ts`

---

## Phase 3: Performance & Pagination

### Dashboard Unbounded List Calls

All four `listX` calls in the dashboard route now have explicit `take` limits (10,000 for conversions/attributions, 200 for segments, 100 for experiments). Previously they loaded entire tables into memory per request.

### Stats Routes Capped

`conversions/stats`, `attribution/stats`, and `journeys/funnel` routes now cap at 50,000 rows per aggregation request to prevent OOM on high-traffic stores.

### Count-vs-Page-Size Fixed

Three list endpoints returned page size instead of total count, making client-side pagination impossible:

| Route | Fix |
|---|---|
| `GET /admin/ad-planning/experiments` | `listAndCountABExperiments` |
| `GET /admin/ad-planning/forecasts` | `listAndCountBudgetForecasts` |
| `GET /admin/ad-planning/journeys` | `listAndCountCustomerJourneys` |

### Segment Member Count

`GET /admin/ad-planning/segments/:id` no longer loads all member rows to compute `member_count`. Uses the stored `customer_count` on the segment (maintained by `buildSegmentWorkflow`), with `listAndCount` fallback.

---

## Segment Enrichment Fixes

### Missing UI Field Aliases

The segment UI field picker exposed fields (`total_orders`, `total_spent`, `avg_order_value`, `days_since_last_order`, `clv`) that didn't exist in the enriched customer data object. All segment rules using these fields silently matched 0 members.

**Fixed by adding computed fields** to `build-segment.ts`:

| UI Field | Backend Computation |
|---|---|
| `total_orders` | Medusa customer order count, fallback to ad-planning purchase conversion count |
| `total_spent` | Sum of `conversion_value` from purchase conversions |
| `avg_order_value` | `total_spent / paidPurchases.length` (excludes €0 drafts) |
| `days_since_last_order` | Days since latest purchase conversion |
| `clv` | CLV score from `CustomerScore` |

### Numeric Comparison Operators

`evaluateSegmentCriteria` compared values using JavaScript's default coercion. Since the UI stores numeric inputs as strings (e.g., `"300"`), comparisons like `5 >= "300"` used lexicographic ordering (always false).

**Fix**: Added `toNumber()` coercion helper for `>=`, `<=`, `>`, `<`, `between` operators.

---

## Customer Scores Enrichment

### Person Name Display

The scores page showed raw `person_id` truncated to 12 characters. Now joins `Person` + Medusa `Customer` (by email) and returns `display_name`, `person`, and `customer` objects.

### Percentile Calculation

The `percentile` field was in the UI interface but never existed on the `CustomerScore` model. The cell's null guard missed `undefined`, producing `NaN`.

**Fix**: Server-side percentile calculation using standard percentile rank formula. Returns `null` when fewer than 2 data points exist per score type.

### Tier Inference

Added server-side tier computation:
- CLV: platinum (≥50k), gold (≥20k), silver (≥5k), bronze
- Engagement/NPS: high (≥75), medium (≥40), low
- Churn risk: high (≥70), medium (≥40), low

---

## Translations Integration

### Model-Level Translatable Fields

Added `.translatable()` to partner-visible text fields across 9 models:

| Model | Translatable Fields |
|---|---|
| `design` | name, description, designer_notes, revision_notes |
| `design_specifications` | title, details, special_instructions, reviewer_notes |
| `design_colors` | name, usage_notes |
| `design_component` | role, notes |
| `task` | title, description, message |
| `task_template` / `task_category` | name, description, message_template |
| `production_runs` | cancelled_reason, finish_notes, completion_notes, rejection_reason, rejection_notes |
| `raw_materials` | name, description, composition, usage_guidelines, storage_requirements |
| `material_types` | name, description |

### Locale Middleware

Added `applyLocale` middleware to all partner GET routes. Route handlers pass `{ locale: req.locale }` to `query.graph()` / `query.index()` calls.

### Partner-UI Integration

`I18nProvider` syncs the current i18n language to the SDK's `x-medusa-locale` global header.

---

## Test Results

All existing + new tests pass:

| Suite | Tests | Status |
|---|---|---|
| `ad-planning-bug-fixes.spec.ts` | 11 | ✅ New |
| `ad-planning-attribution.spec.ts` | 15 | ✅ Pass |
| `ad-planning-conversions.spec.ts` | 22 | ✅ Pass |
| `ad-planning-experiments.spec.ts` | 22 | ✅ Pass |
| `design-translations.spec.ts` | 6 | ✅ New |
| **Total** | **76** | **All passing** |

---

## Migrations

| Migration | Changes |
|---|---|
| `Migration20260410033050.ts` (ad_planning) | `CampaignAttribution.platform` adds "direct" + default changed to "direct"; `SegmentMember` unique index on `(segment_id, person_id)` |
| `Migration20260410035444.ts` (ad_planning) | `BudgetForecast` unique index on `(ad_campaign_id, forecast_date)`; `Conversion.currency` changed to nullable |
| `Migration20260410031716.ts` (analytics) | `AnalyticsSession` adds UTM columns (utm_source, utm_medium, utm_campaign, utm_term, utm_content) + index |
