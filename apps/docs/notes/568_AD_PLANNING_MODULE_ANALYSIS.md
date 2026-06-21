# 568 — Ad-Planning Module: Grounded Behaviour Analysis

## Purpose

The `ad_planning` module (module key `AD_PLANNING_MODULE`) tracks ad conversions, manages A/B experiments, forecasts budget performance, and computes consumer-insight scores (NPS, engagement, CLV, churn risk, sentiment, customer journey, segmentation). It is registered as a Medusa 2.x lifecycle module at `apps/backend/src/modules/ad-planning/index.ts:6-8` and exposes a service (`AdPlanningService`) that extends `MedusaService` over 9 models at `apps/backend/src/modules/ad-planning/service.ts:17-30`.

---

## Entry Points

### Admin REST API (`apps/backend/src/api/admin/ad-planning/`)

| Route | File | Methods |
|---|---|---|
| `GET /admin/ad-planning/goals` | `.../goals/route.ts:GET` | List goals (paginated, filterable by `website_id`, `goal_type`, `is_active`) |
| `POST /admin/ad-planning/goals` | `.../goals/route.ts:POST` | Create a goal |
| `GET /admin/ad-planning/goals/:id` | `.../goals/[id]/route.ts:GET` | Get single goal |
| `PUT /admin/ad-planning/goals/:id` | `.../goals/[id]/route.ts:PUT` | Update goal |
| `DELETE /admin/ad-planning/goals/:id` | `.../goals/[id]/route.ts:DELETE` | Delete goal |
| `GET /admin/ad-planning/conversions` | `.../conversions/route.ts:GET` | List conversions (paginated, filterable) |
| `POST /admin/ad-planning/conversions` | `.../conversions/route.ts:POST` | Create conversion manually |
| `GET /admin/ad-planning/conversions/stats` | `.../conversions/stats/route.ts:GET` | Aggregated stats (groupable by day/week/month/type/platform/campaign) |
| `GET /admin/ad-planning/conversions/:id` | `.../conversions/[id]/route.ts` | Single conversion detail |
| `POST /admin/ad-planning/conversions/:id/google-upload` | `.../conversions/[id]/google-upload/route.ts` | Upload conversion to Google Ads |
| `GET /admin/ad-planning/attribution` | `.../attribution/route.ts:GET` | List campaign attributions |
| `POST /admin/ad-planning/attribution` | `.../attribution/route.ts:POST` | Create attribution manually |
| `POST /admin/ad-planning/attribution/resolve` | `.../attribution/resolve/route.ts:POST` | Single-session or bulk-attribution resolution |
| `GET /admin/ad-planning/attribution/stats` | `.../attribution/stats/route.ts:GET` | Attribution statistics |
| `GET /admin/ad-planning/experiments` | `.../experiments/route.ts:GET` | List A/B experiments |
| `POST /admin/ad-planning/experiments` | `.../experiments/route.ts:POST` | Create experiment |
| `GET /admin/ad-planning/experiments/:id` | `.../experiments/[id]/route.ts` | Single experiment |
| `POST /admin/ad-planning/experiments/:id/start` | `.../experiments/[id]/start/route.ts` | Start experiment |
| `POST /admin/ad-planning/experiments/:id/stop` | `.../experiments/[id]/stop/route.ts` | Stop experiment |
| `GET /admin/ad-planning/experiments/:id/results` | `.../experiments/[id]/results/route.ts` | Experiment results |
| `GET /admin/ad-planning/forecasts` | `.../forecasts/route.ts:GET` | List budget forecasts |
| `POST /admin/ad-planning/forecasts` | `.../forecasts/route.ts:POST` | Generate forecast (imports `generateForecast`, `recommendBudget` from `utils/forecast-engine.ts`) |
| `GET /admin/ad-planning/forecasts/accuracy` | `.../forecasts/accuracy/route.ts` | Forecast accuracy metrics |
| `GET /admin/ad-planning/dashboard` | `.../dashboard/route.ts:GET` | Dashboard overview (aggregates conversions, attributions, segments, experiments, campaigns) |
| `GET /admin/ad-planning/journeys` | `.../journeys/route.ts:GET` | List journey events |
| `POST /admin/ad-planning/journeys` | `.../journeys/route.ts:POST` | Create journey event (auto-determines stage) |
| `GET /admin/ad-planning/journeys/:personId` | `.../journeys/[personId]/route.ts` | Single-person timeline |
| `GET /admin/ad-planning/journeys/funnel` | `.../journeys/funnel/route.ts` | Funnel analysis |
| `GET /admin/ad-planning/nps` | `.../nps/route.ts:GET` | NPS score + monthly trend |
| `GET /admin/ad-planning/predictive` | `.../predictive/route.ts:GET` | List churn-risk / CLV predictions |
| `POST /admin/ad-planning/predictive` | `.../predictive/route.ts:POST` | Calculate prediction for a person |
| `GET /admin/ad-planning/predictive/at-risk` | `.../predictive/at-risk/route.ts:GET` | At-risk customers (churn score >= threshold, enriched with person + CLV) |
| `GET /admin/ad-planning/scores` | `.../scores/route.ts:GET` | List customer scores (paginated, enriched with percentile, tier, person/customer names) |
| `POST /admin/ad-planning/scores` | `.../scores/route.ts:POST` | Calculate a score (NPS/engagement/CLV/churn risk) |
| `GET /admin/ad-planning/segments` | `.../segments/route.ts:GET` | List customer segments |
| `POST /admin/ad-planning/segments` | `.../segments/route.ts:POST` | Create segment (optionally builds immediately) |
| `GET /admin/ad-planning/segments/:id` | `.../segments/[id]/route.ts` | Single segment |
| `POST /admin/ad-planning/segments/:id/members` | `.../segments/[id]/members/route.ts` | Manage segment members |
| `GET /admin/ad-planning/sentiment` | `.../sentiment/route.ts:GET` | List sentiment analyses (with stats, top keywords/emotions/entities/topics) |
| `POST /admin/ad-planning/sentiment` | `.../sentiment/route.ts:POST` | Analyze text sentiment |

### Web (Public) API (`apps/backend/src/api/web/ad-planning/`)

| Route | File | Methods | Auth |
|---|---|---|---|
| `POST /web/ad-planning/track-conversion` | `.../track-conversion/route.ts:POST` | Client-side conversion tracking | `AUTHENTICATE = false` (`route.ts:101`) |
| `POST /web/ad-planning/track-journey` | `.../track-journey/route.ts:POST` | Client-side journey event tracking | `AUTHENTICATE = false` (`route.ts:139`) |
| `GET /web/ad-planning/intent` | `.../intent/route.ts:GET` | Compute 0-100 intent score for anonymous visitor (live, no writes) | `AUTHENTICATE = false` (`route.ts:127`) |

### Subscribers (`apps/backend/src/subscribers/ad-planning/`)

| File | Event | What it does |
|---|---|---|
| `analytics-event-created.ts` | `analytics_event.created` | Maps event to conversion type via `EVENT_TO_CONVERSION_MAP`; checks custom goals; runs `trackConversionWorkflow` and optionally `resolveSessionAttributionWorkflow` |
| `feedback-created.ts` | `feedback.created` | Runs `analyzeSentimentWorkflow` (if content >= 10 chars) and `calculateNPSWorkflow` (if rating + person_id present) |
| `form-response-created.ts` | `form_response.created` | Runs `trackLeadConversionWorkflow` |
| `lead-created.ts` | `lead.created` | Runs `trackLeadConversionWorkflow` |
| `order-placed.ts` | `order.placed` | Runs `trackPurchaseConversionWorkflow` |

### Jobs (`apps/backend/src/jobs/ad-planning/`)

| File | Schedule | What it does |
|---|---|---|
| `recalculate-scores-job.ts` | `0 3 * * 0` (Sun 3AM) | Paginates person IDs with activity in last 30d; runs `calculateEngagementWorkflow`, `calculateChurnRiskWorkflow`, `calculateCLVWorkflow` for each (concurrency=5) |
| `resolve-attributions-job.ts` | `0 2 * * *` (daily 2AM) | Runs `bulkResolveAttributionsWorkflow` for last 7 days, limit 5000 |
| `rebuild-segments-job.ts` | `0 4 * * *` (daily 4AM) | Lists active `auto_update` segments and runs `buildSegmentWorkflow` for each |

### Workflows (`apps/backend/src/workflows/ad-planning/`)

| File | Symbols |
|---|---|
| `attribution/bulk-resolve-attributions.ts` | `bulkResolveAttributionsWorkflow` |
| `attribution/resolve-session-attribution.ts` | `resolveSessionAttributionWorkflow` |
| `conversions/track-conversion.ts` | `trackConversionWorkflow` |
| `conversions/track-lead-conversion.ts` | `trackLeadConversionWorkflow` |
| `conversions/track-purchase-conversion.ts` | `trackPurchaseConversionWorkflow` |
| `predictive/calculate-churn-risk.ts` | `calculateChurnRiskWorkflow` |
| `predictive/calculate-clv.ts` | `calculateCLVWorkflow` |
| `scoring/calculate-engagement.ts` | `calculateEngagementWorkflow` |
| `scoring/calculate-nps.ts` | `calculateNPSWorkflow` |
| `segments/build-segment.ts` | `buildSegmentWorkflow` |
| `sentiment/analyze-sentiment.ts` | `analyzeSentimentWorkflow` |

---

## Data Models & Links

All models defined with `model.define(...)` from `@medusajs/framework/utils` under `apps/backend/src/modules/ad-planning/models/`.

| Model | File | Module links | Key indexes |
|---|---|---|---|
| `ConversionGoal` | `models/conversion-goal.ts` | `website_id` (text, nullable, no FK) | `idx_goal_website_active` (`website_id`, `is_active`); `idx_goal_type` |
| `Conversion` | `models/conversion.ts` | `ad_campaign_id`, `ad_set_id`, `ad_id` (text, nullable, no FK — links to socials module); `order_id`, `analytics_event_id`, `analytics_session_id`, `lead_id`, `person_id`, `visitor_id`, `website_id` | 5 indexes: website+time, campaign, type+time, person, visitor |
| `CampaignAttribution` | `models/campaign-attribution.ts` | `analytics_session_id` (unique), `ad_campaign_id`, `ad_set_id`, `ad_id` | 5 indexes including `idx_attribution_session_unique` |
| `ABExperiment` | `models/ab-experiment.ts` | `website_id` | `idx_experiment_status`, `idx_experiment_website_status` |
| `BudgetForecast` | `models/budget-forecast.ts` | `ad_account_id`, `ad_campaign_id` | `idx_forecast_campaign_date_unique` (unique on campaign+date) |
| `CustomerSegment` | `models/customer-segment.ts` | none | `idx_segment_active`, `idx_segment_type` |
| `SegmentMember` | `models/segment-member.ts` | `segment` (`belongsTo` → `CustomerSegment`); `person_id` | `idx_segment_member_person`, `idx_segment_member_unique` (unique on segment+person) |
| `CustomerScore` | `models/customer-score.ts` | `person_id` | `idx_score_person_type_unique` (unique on person+type) |
| `SentimentAnalysis` | `models/sentiment-analysis.ts` | `source_id` (polymorphic); `person_id` | `idx_sentiment_source_unique` (unique on source type+id) |
| `CustomerJourney` | `models/customer-journey.ts` | `person_id`, `visitor_id`, `ad_campaign_id`, `website_id` | 5 indexes on person/visitor/type/stage/website + time |

All foreign-key-style fields are `model.text()` (no actual FK constraints at the database level) — cross-module references are logical, not enforced.

---

## Key Behaviours

### 1. Goals CRUD — Create flow

**Backend**: `POST /admin/ad-planning/goals` at `apps/backend/src/api/admin/ad-planning/goals/route.ts:80-87`. Validates body with `CreateGoalSchema` (Zod), then calls `adPlanningService.createConversionGoals([data])` and responds with `201 { goal }`.

**Frontend**: The "Create goal" button at `apps/backend/src/admin/routes/ad-planning/goals/page.tsx:212-216` is a `<Link to="/ad-planning/goals/create">` — it navigates to a **standalone page** (`/ad-planning/goals/create`), NOT a RouteFocusModal or drawer.

The create page at `apps/backend/src/admin/routes/ad-planning/goals/create/page.tsx` renders `GoalForm mode="create"` inside a plain `Container` (`create/page.tsx:8-24`). On success it navigates to the new goal's detail page: `navigate(\`/ad-planning/goals/${goalId}\`, { replace: true })` (`create/page.tsx:20-22`).

**Bug for #568**: "Create Goal should open a RouteFocusModal" — currently opens a full page. Contrast with the *edit* flow which already uses `RouteDrawer` (see below). The create flow needs `RouteFocusModal` + route focus pattern consistent with the edit drawer.

### 2. Goals CRUD — Per-goal Edit flow

**Backend**: `PUT /admin/ad-planning/goals/:id` at `apps/backend/src/api/admin/ad-planning/goals/[id]/route.ts:60-79`. Validates with `UpdateGoalSchema` (all fields optional), does existence check with `listConversionGoals({ id })`, then calls `adPlanningService.updateConversionGoals({ id, ...data })`. Returns `{ goal }`.

**Frontend detail page**: `apps/backend/src/admin/routes/ad-planning/goals/[id]/page.tsx`. The "Edit" button at line 164-168 is `<Link to="edit">` — a relative link to the `@edit` parallel route. The page renders `<Outlet />` at line 126.

**Frontend edit drawer**: `apps/backend/src/admin/routes/ad-planning/goals/[id]/@edit/page.tsx`. Uses `RouteDrawer` (from `components/modal/route-drawer/route-drawer`). Fetches the goal with `GET /admin/ad-planning/goals/${id}`, populates `GoalFormValues`, passes to `GoalForm mode="edit"` with `goalId={id}`. On cancel/success calls `handleSuccess()` from `useRouteModal()`.

**Frontend `GoalForm`**: `apps/backend/src/admin/components/ad-planning/goals/goal-form.tsx`. Handles both `mode="create"` and `mode="edit"`. In `"edit"` mode, sends `PUT /admin/ad-planning/goals/${goalId}` (`goal-form.tsx:148-151`). The form strips empty condition fields before sending and handles custom JSON parsing for `custom_conditions`.

**Bug for #568**: "per-goal Edit is broken". The edit drawer at `@edit/page.tsx` properly fetches the goal and renders `GoalForm` in edit mode. The `GoalForm` submits to `PUT /admin/ad-planning/goals/${goalId}`. The PUT handler calls `updateConversionGoals({ id, ...data })`. Potential issues (unverified):

- `updateConversionGoals` (from `MedusaService`) may expect an **array** of updates (Medusa convention is `update<Entity>(selector, data)` or `update<Entity>(data[])`). The PUT handler passes a single object `{ id, ...data }`. If `MedusaService.updateConversionGoals` expects an array, the call may silently no-op or error. (`service.ts` delegates to auto-generated `MedusaService` methods — the exact signature is inherited and not in this codebase.)
- The `GoalForm` strips `description: undefined` and other undefined fields before sending (`goal-form.tsx:127-139`). If the PUT handler receives a payload without a field, `UpdateGoalSchema` makes it optional, but `updateConversionGoals` may not merge partial updates — it may overwrite with `undefined`.
- The `GoalForm` auto-fills `goal_type: "purchase"` as default (`goal-form.tsx:62`). When editing, `initial` fields pass through, but the initial state merges `DEFAULT_VALUES` which sets `goal_type: "purchase"`. If the API returns a goal with a different `goal_type`, the initial override at `@edit/page.tsx:31` (`goal_type: data.goal.goal_type`) should override it — verify this works correctly.

### 3. Goal Counter / Metadata Pattern

Goal counters (`current_count`, `current_value`, `last_conversion_at`) are stored inside `goal.metadata` JSON — NOT as separate columns. Their JSDoc says they are "Tracked by track-conversion's updateGoalsStep on each matching conversion" (`[id]/page.tsx:200-201`). This means `metadata` is a computed/impure column: part human-configured fields (e.g., `google_ads.*`) and part system-updated counters. Concurrent writes to `metadata` risk clobbering.

### 4. Intent Score Computation

`computeIntentScore()` at `apps/backend/src/modules/ad-planning/service.ts:156-180` is a pure function (no I/O) that computes a 0-100 intent score from aggregated signals. Called by the web route `GET /web/ad-planning/intent` at `apps/backend/src/api/web/ad-planning/intent/route.ts:99-104`. Score thresholds: `score >= 70 → "high"`, `>= 30 → "medium"`, else `"low"`. The JSDoc explains weight tuning rationale: "a visitor who scrolled 100% AND spent 400s on a page hits ~70 (high) without any pageviews counted. Bots that load one page and bounce deterministically score 5 (low)" (`service.ts:152-155`).

### 5. Attribution Resolution

The `analytics_event.created` subscriber at `apps/backend/src/subscribers/ad-planning/analytics-event-created.ts` auto-resolves attribution when `utm_campaign` and `session_id` are present (`analytics-event-created.ts:121-142`). Duplicate errors on the `idx_attribution_session_unique` index are silently swallowed (`analytics-event-created.ts:129-135`).

UTM-to-campaign matching logic lives in `service.ts:resolveUtmToCampaign()` (`service.ts:186-229`) — tries exact name match, then exact `meta_campaign_id` match, then fuzzy substring match (confidence 0.7).

### 6. Segment Criteria Evaluation

`evaluateSegmentCriteria()` at `service.ts:249-364` supports nested groups (`AND/OR/NOT` logic), string coercion for numeric comparison operators (JSDoc: "the segment rule form stores numeric inputs as strings"), and date-relative operators (`within_last_days`, `older_than_days`). Empty criteria matches everyone (`service.ts:351`).

### 7. Statistical Significance (Experiments)

`apps/backend/src/modules/ad-planning/utils/statistical-utils.ts` implements two-tailed z-test with Abramowitz & Stegun erf approximation. The `calculatePValue()` function (`statistical-utils.ts:39-60`) was previously buggy — the comment at lines 34-38 documents that the prior implementation "used `sign * y` inside the CDF which produced `p > 1` for negative z-scores, causing every 'treatment outperforms control' experiment to be flagged non-significant."

---

## Gotchas / Invariants

1. **Metadata is a mixed-responsibility JSON column**: `goal.metadata` stores both user-curated config (`google_ads.*`) and system-updated counters (`current_count`, `current_value`, `last_conversion_at`). The `GoalGoogleAdsMappingForm` at `goal-google-ads-mapping-form.tsx:118-134` does a JSON merge spread (`...existing`) to preserve sibling fields, but there is no locking — concurrent goal update + counter increment could lose data.

2. **BudgetForecast has a unique constraint on `[ad_campaign_id, forecast_date]`** (`models/budget-forecast.ts:57-59`) — the JSDoc explicitly says this makes re-running the forecast job "idempotent" and prevents "duplicate rows from inflating accuracy metrics and MAPE calculations."

3. **`updateConversionGoals()` call signature uncertainty**: The PUT handler passes `{ id, ...data }` as a single object to `updateConversionGoals()` (`goals/[id]/route.ts:73-76`). `MedusaService` auto-generates `update<Entity>` with various overloads. If the expected form is `update<Entity>(selector, data)` or an array, this pattern may silently no-op.

4. **NPS scale inference edge case**: In `feedback-created.ts:64-71`, when `scale` is not explicitly provided, the code infers 5-point vs 10-point from the rating value: `< 6` means 5-point. The comment explains the subtle reasoning — preventing "a rating of exactly 5" from being "silently misrouted" as a 10-point rating.

5. **Intent score is never persisted**: The `GET /web/ad-planning/intent` route docstring explains it does NOT write a `CustomerScore` row because "`customer_score` requires a `person_id`" (anon traffic) and "the underlying signals already live in `analytics_event` and `conversion` so caching adds staleness" (`intent/route.ts:11-15`).

6. **`EVENT_TO_CONVERSION_MAP` is a hard-coded lookup**: The `analytics_event.created` subscriber maps pre-defined event names to conversion types in a static `Record<string, string>` (`analytics-event-created.ts:29-37`). Unmapped events fall through to a custom-goal lookup that only matches `goal_type: "custom"` goals and checks `goal.trigger_event_name` — a field that does not exist in the `ConversionGoal` model (`models/conversion-goal.ts` has no `trigger_event_name`). This custom-goal branch (`analytics-event-created.ts:60-96`) may never match.

7. **`Dashboard MAX_ROWS` cap**: The dashboard route enforces `DASHBOARD_MAX_ROWS = 10000` (`dashboard/route.ts:25`) to prevent OOM from unbounded aggregations.

8. **Soft error swallowing in public web endpoints**: Both `POST /web/ad-planning/track-conversion` and `POST /web/ad-planning/track-journey` catch all errors and respond `200 { success: true }` regardless, logging to console only (`track-conversion/route.ts:91-97`, `track-journey/route.ts:130-136`). The docstring says "Don't expose errors to client for security."

9. **Segment criteria supports nested groups**: `evaluateSegmentCriteria()` supports recursive `groups`, enabling complex boolean nesting (`AND/OR/NOT`). This is validated by `SegmentGroupSchema` in the API using `z.lazy()` for recursion (`segments/route.ts:60-67`).

10. **Chart of accounts**: The `currency` field on `Conversion` is explicitly `nullable` — the JSDoc at `models/conversion.ts:50-53` explains it was changed from defaulting to `"INR"` to nullable, forcing the caller to pass a value matching the store locale.

---

## Open Questions / (unverified)

1. **`trigger_event_name` field on ConversionGoal**: The analytics subscriber at `analytics-event-created.ts:66` accesses `goal.trigger_event_name?.toLowerCase()`, but the `ConversionGoal` model (`conversion-goal.ts`) has no `trigger_event_name` column. This may be a leftover field from an earlier schema version or the field lives in `conditions` JSON. Unverified which is correct.

2. **Per-goal Edit "broken" — root cause**: The edit drawer UI (`@edit/page.tsx → RouteDrawer → GoalForm`) appears structurally correct. If the edit is broken, possible causes (unverified):
   - `MedusaService.updateConversionGoals` call signature mismatch (single object vs array/selector+data).
   - Partial-update merge failure — `PUT` handler spreads `data` over `{ id, ...data }`, but `UpdateGoalSchema` strips `undefined` fields during `.parse()`, so absent fields are never sent and `updateConversionGoals` may set them to `undefined` (overwriting existing values).
   - `GoalForm`'s default-value merge: `DEFAULT_VALUES.goal_type = "purchase"` could override the fetched goal's type if `initial` doesn't override it properly (`goal-form.tsx:62`). However `@edit/page.tsx:31` explicitly sets `goal_type: data.goal.goal_type`.

3. **RouteFocusModal not used for Create**: The create page at `goals/create/page.tsx` uses a plain `Container` layout without `RouteDrawer` or `RouteFocusModal`. The detail page at `[id]/page.tsx` renders `<Outlet />` which sibling `@edit` and `@google-ads-mapping` parallel routes populate as `RouteDrawer` drawers. The create flow should likely be converted to the same parallel-route pattern with a focus modal/drawer.
