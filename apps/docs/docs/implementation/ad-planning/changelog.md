---
title: "Ad Planning - Changelog (March 2026)"
sidebar_label: "Changelog"
sidebar_position: 4
---

# Ad Planning Module — Changelog (March 2026)

Major overhaul addressing bug fixes, data integrity issues, automation gaps, and UI improvements across the entire ad-planning module.

---

## Phase 1: Critical Bug Fixes

### Broken UI → API Routes Fixed
- **Attribution page** — "Resolve Attributions" button was calling a non-existent `POST /attribution/bulk-resolve`. Fixed to use `POST /attribution/resolve` with `{ bulk: true }`.
- **Segment rebuild** — "Rebuild Segment" called non-existent `POST /segments/:id/build`. Now uses `PUT /segments/:id` with `{ rebuild: true }`, which triggers `buildSegmentWorkflow` and returns build results.
- **Metrics page** — Was fetching non-existent `scores/tier-distribution` and `attribution/summary` endpoints. Rewired to use `scores?limit=1` (aggregates) and `attribution/stats`.

### Field/Enum Mismatches Fixed
- **Attribution page interface** — UI defined fields (`session_id`, `campaign_name`, `attribution_model`, `touch_type`, `converted`, `conversion_value`) that don't exist on the `CampaignAttribution` model. Rewrote to use actual model fields (`analytics_session_id`, `ad_campaign_id`, `platform`, `is_resolved`, `resolution_method`, `session_pageviews`).
- **Segment types** — UI offered `"value"` and `"engagement"` which the API rejects. Fixed to match model enum: `"behavioral"`, `"demographic"`, `"rfm"`, `"custom"`.
- **Segment `status` field** — UI used `status: "active"` but model has `is_active: boolean`. Fixed interface, columns, create handler, and metrics page filter.

### Pagination Fixed
- **Scores endpoint** — `count` returned paginated slice length, breaking DataTable pagination after page 1. Now uses `listAndCountCustomerScores` for total count.
- **Segment members endpoint** — Same issue, same fix with `listAndCountSegmentMembers`.

### Calculation Bugs Fixed
- **NPS scale normalization** — A 10-point rating of `5` was silently doubled to `10` (promoter). Now only converts when `scale === "5"` is explicitly passed, using full-range mapping `(rating - 1) * 2.5`.
- **CLV single-purchase inflation** — Single-purchase customers got `monthlyFrequency = 1` and 36-month lifespan. Fixed to conservative `1/3 monthly frequency` and 12-month lifespan.
- **Churn risk weights** — `support_ticket_increase` factor (weight 0.1) was declared but never computed, making max score 0.90. Removed and redistributed weights to sum to 1.0.

### Segment Integrity Fixed
- **Added composite unique index** on `(segment_id, person_id)` in `SegmentMember` to prevent duplicate members from concurrent builds.
- **Manual member preservation** — Rebuild now only removes `rule_match` members, preserving manually added and imported members.
- **Count accuracy** — `customer_count` is now queried from actual member table after add/remove, not from the pre-update evaluation count.

### Attribution Logic Fixed
- **`meta_campaign_id` normalization** — Meta campaign ID match now compares both raw and lowercased values (was case-sensitive inconsistency).
- **Bulk resolve dedup** — Deduplicates by `analytics_session_id` before batch insert to prevent unique constraint violations.
- **Bulk error handling** — Falls back to per-record inserts when batch fails, instead of silently losing the entire batch.
- **Existing record check** — Fetches ALL existing attributions (not just resolved ones) to prevent constraint violations.

### Scores API Fixed
- **CLV & churn_risk** — Now triggerable via `POST /admin/ad-planning/scores`. Previously returned 400 despite workflows existing.
- **Engagement dead code** — Removed unused `ANALYTICS_MODULE` resolve from engagement workflow.

### UI Filter Fixes
- Attribution model dropdown → replaced with working `is_resolved` filter (Resolved/Unresolved).
- Removed non-functional source filter and tier filter that were stripped by Zod.

---

## Phase 2: Automation & Data Integrity

### `order.placed` Now Resolves `person_id`
Added `resolvePersonStep` to `trackPurchaseConversionWorkflow` that matches order email → person record. All downstream steps (CLV, journey, engagement, churn) now receive the resolved `person_id` instead of always getting `undefined`.

### CLV Dual-Write Eliminated
Replaced `updateCustomerValueStep` (which did `score_value += order_total` — a running total) with `recalculateCLVStep` that performs the full BG/NBD-inspired prediction. The `clv` score now always contains the predicted value with `remaining_clv` and `tier` in metadata.

### Engagement Dual-Write Eliminated
Replaced `updateEngagementStep` in `analyzeSentimentWorkflow` (which patched `+10`/`+15` directly) with `recalculateEngagementStep` that does a full activity-weighted recalculation using the same weights and time-decay logic as `calculateEngagementWorkflow`.

### Auto Score Recalculation After Events
**Purchase path** (`order.placed` → `trackPurchaseConversionWorkflow`):
1. Resolve person from email
2. Find attribution
3. Create conversion
4. **Recalculate CLV** (full prediction)
5. Add journey event
6. **Recalculate engagement** (full)
7. **Recalculate churn risk** (full)
8. **Rebuild auto-update segments**

**Feedback path** (`feedback.created`):
- Sentiment analysis triggers full engagement recalculation
- If feedback has a numeric `rating` + `person_id`, automatically runs `calculateNPSWorkflow`

### Segment Auto-Rebuild
After all scores are refreshed post-purchase, `rebuildAutoSegmentsStep` finds all segments with `is_active: true` and `auto_update: true`, then runs `buildSegmentWorkflow` for each.

### Auto Attribution Resolution
`analytics-event-created` subscriber now auto-resolves session attribution when `utm_campaign` data is present. No more requiring manual bulk resolve.

### Forecast Actuals from Real Spend
`forecasts/accuracy` endpoint now pulls actual spend from `AdInsights` via the socials module instead of writing `predicted_spend` as `actual_spend`.

### Sentiment AI Data Surfaced
`GET /sentiment` now returns `top_entities`, `top_topics`, and `recent_summaries` alongside existing keywords and emotions.

### Funnel Includes Anonymous Visitors
Journey funnel analysis now uses `person_id || visitor_id` as the entity key. Response includes `identified_customers` and `anonymous_visitors` breakdown.

---

## Phase 3: UI/UX Polish

### Dashboard Landing Page
Complete rewrite with 6 live KPI cards (Conversions, Revenue, Active Segments, Running Experiments, Attribution Rate, Scored Customers) and contextual badges on navigation cards.

### Conversions Page
- Added 4 summary KPI cards (Total Conversions, Total Value, Purchases, Avg Value)
- Order ID column with clickable links to `/orders/{id}`
- Campaign column links to attribution page
- Person ID column links to journey timeline

### Journeys Page
- Added `FunnelChart` component with horizontal bar visualization
- Drop-off percentages, conversion rate badge, biggest drop-off highlight
- Identified vs anonymous visitor breakdown
- Person IDs link to journey timelines, purchase events link to orders

### Experiments Detail Page
- **Edit button** for draft experiments (name + description)
- **Sample progress bar** showing current/target with control vs treatment split
- Progress bar turns green when target reached

### Cross-Linking
All pages now include contextual navigation links between related records (conversions ↔ attribution, conversions ↔ orders, journeys ↔ persons, etc.).

---

## Test Results

All 143 integration tests pass across 7 test suites:

| Suite | Tests |
|-------|-------|
| Segments | 19/19 |
| Scores | 17/17 |
| Attribution | 15/15 |
| Conversions | 22/22 |
| Journeys | 24/24 |
| Experiments | 22/22 |
| Predictive | 24/24 |
