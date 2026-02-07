# Ad Planning & Consumer Insights Platform - Implementation Plan

## Overview

Create a comprehensive **Ad Planning & Consumer Insights** platform that bridges ad campaigns, website analytics, and customer intelligence to enable:

### Ad Planning Features
- Full conversion tracking (leads, purchases, engagements)
- Campaign attribution (linking UTM → campaigns)
- A/B testing with statistical significance
- Budget forecasting
- ROI dashboard

### Consumer Insights Features (NEW)
- **Sentiment Analysis** - AI-powered analysis of feedback, comments, social mentions
- **Customer Segmentation** - Behavioral, demographic, and RFM-based segments
- **NPS Calculation** - Net Promoter Score tracking and trends
- **Engagement Scoring** - Unified customer engagement metrics
- **Customer Journey Mapping** - Cross-channel interaction timeline
- **Churn Prediction** - AI-driven at-risk customer identification

### Data Sources
- Internal: Analytics events, forms, feedback, leads, orders
- Social: Meta/Instagram insights, mentions, hashtags
- External: Web scraping for competitor intelligence (future)

---

## 1. New Module: `ad-planning`

**Location**: `src/modules/ad-planning/`

### Models

#### Ad Planning Models
| Model | Purpose |
|-------|---------|
| `Conversion` | Tracks conversion events tied to ad campaigns (leads, purchases, custom) |
| `ConversionGoal` | Defines what qualifies as a conversion (conditions, value) |
| `CampaignAttribution` | Links analytics sessions to ad campaigns via UTM resolution |
| `ABExperiment` | Tracks A/B test experiments with statistical results |
| `BudgetForecast` | Stores predicted vs actual spend/performance |

#### Consumer Insights Models (NEW)
| Model | Purpose |
|-------|---------|
| `CustomerSegment` | Defines customer segments with rules-based or behavioral criteria |
| `CustomerScore` | Stores computed scores (NPS, engagement, CLV, churn risk) per customer |
| `SentimentAnalysis` | Caches AI-analyzed sentiment for feedback, comments, mentions |
| `CustomerJourney` | Tracks cross-channel interaction timeline per customer |

### Key Model Fields

**Conversion**:
- `conversion_type`: lead_form_submission, add_to_cart, begin_checkout, purchase, page_engagement, custom
- `ad_campaign_id`, `ad_set_id`, `ad_id` - attribution links
- `utm_source`, `utm_medium`, `utm_campaign` - raw UTM data
- `conversion_value`, `currency` - monetary tracking
- `order_id` - for purchase conversions
- `visitor_id`, `session_id` - analytics links

**CampaignAttribution**:
- `analytics_session_id` - link to AnalyticsSession
- `ad_campaign_id` - resolved campaign
- `is_resolved`, `resolution_method` - tracking resolution status
- `platform`: meta, google, generic

**CustomerSegment** (NEW):
- `name`, `description` - segment identification
- `segment_type`: behavioral, demographic, rfm, custom
- `criteria` (JSON) - rules for segment membership
- `customer_count`, `last_calculated_at` - stats
- `is_active`, `auto_update` - configuration

**CustomerScore** (NEW):
- `person_id` - link to Person
- `score_type`: nps, engagement, clv, churn_risk
- `score_value` (float) - computed score
- `breakdown` (JSON) - component scores
- `calculated_at`, `expires_at` - freshness tracking

**SentimentAnalysis** (NEW):
- `source_type`: feedback, form_response, social_mention, comment
- `source_id` - reference to source record
- `sentiment_score` (float) - -1 to 1
- `sentiment_label`: positive, negative, neutral, mixed
- `keywords`, `entities` (JSON) - extracted data
- `model_version` - AI model used

**CustomerJourney** (NEW):
- `person_id` - link to Person
- `event_type`: form_submit, feedback, purchase, page_view, social_engage, lead_capture
- `event_data` (JSON) - event details
- `channel`: web, social, email, sms
- `stage`: awareness, consideration, conversion, retention
- `timestamp` - when event occurred

---

## 2. API Endpoints

### Attribution (`/admin/ad-planning/attribution/`)
- `GET /` - List attributions
- `GET /stats` - Stats by campaign
- `POST /resolve` - Manual resolve
- `POST /bulk-resolve` - Batch resolve

### Conversions (`/admin/ad-planning/conversions/`)
- `GET /` - List conversions
- `GET /:id` - Get conversion
- `POST /` - Manual conversion
- `GET /stats` - Conversion statistics
- `GET /funnel` - Funnel analysis

### Goals (`/admin/ad-planning/goals/`)
- CRUD for conversion goals

### Experiments (`/admin/ad-planning/experiments/`)
- CRUD + `POST /:id/start`, `POST /:id/stop`
- `GET /:id/results` - Statistical results

### Forecasts (`/admin/ad-planning/forecasts/`)
- `GET /` - List forecasts
- `POST /generate` - Generate forecast
- `GET /accuracy` - Accuracy report

### Dashboard (`/admin/ad-planning/dashboard/`)
- `GET /overview` - Performance overview
- `GET /roi` - ROI by campaign
- `GET /top-performers` - Top campaigns
- `GET /trends` - Performance trends

### Storefront (`/web/ad-planning/`)
- `POST /track-conversion` - Client-side conversion tracking

---

### Consumer Insights Endpoints (NEW)

### Segments (`/admin/ad-planning/segments/`)
- `GET /` - List all customer segments
- `GET /:id` - Get segment with member count
- `POST /` - Create segment with criteria
- `PUT /:id` - Update segment rules
- `DELETE /:id` - Delete segment
- `GET /:id/members` - List customers in segment
- `POST /:id/calculate` - Recalculate segment membership
- `POST /bulk-calculate` - Recalculate all active segments

### Sentiment (`/admin/ad-planning/sentiment/`)
- `GET /` - List sentiment analyses
- `GET /stats` - Aggregate sentiment stats (by source type, time)
- `POST /analyze` - Trigger AI sentiment analysis for a source
- `POST /bulk-analyze` - Batch analyze unprocessed items
- `GET /trends` - Sentiment trends over time

### NPS (`/admin/ad-planning/nps/`)
- `GET /score` - Get current NPS score (overall or by segment)
- `GET /trends` - NPS trends over time
- `GET /breakdown` - Promoters/Passives/Detractors breakdown
- `GET /by-segment` - NPS comparison across segments

### Customer Scores (`/admin/ad-planning/scores/`)
- `GET /` - List customer scores with filters
- `GET /person/:id` - Get all scores for a customer
- `POST /calculate/:type` - Calculate specific score type for all customers
- `GET /leaderboard` - Top customers by engagement/CLV

### Journey (`/admin/ad-planning/journey/`)
- `GET /person/:id` - Get customer journey timeline
- `GET /funnel` - Conversion funnel analysis
- `GET /paths` - Common customer paths
- `GET /dropoff` - Identify journey dropoff points

### Unified Customer View (`/admin/ad-planning/customers/`)
- `GET /:id/profile` - Complete customer profile with all data
- `GET /:id/interactions` - All touchpoints (forms, feedback, orders, social)
- `GET /at-risk` - Customers with high churn risk
- `GET /top-engaged` - Most engaged customers

---

## 3. Workflows

### Attribution
1. **`resolve-session-attribution`** - Match UTM → campaign for single session
2. **`bulk-resolve-attributions`** - Batch resolve unattributed sessions

### Conversion Tracking
3. **`track-conversion`** - Generic conversion from analytics event
4. **`track-purchase-conversion`** - E-commerce purchase (order.placed)
5. **`track-lead-conversion`** - Lead form submission (lead.created)

### Forecasting
6. **`generate-budget-forecast`** - Predict spend/conversions from history

### A/B Testing
7. **`calculate-experiment-results`** - Statistical significance calculation

### Consumer Insights Workflows (NEW)

#### Sentiment Analysis
8. **`analyze-sentiment`** - AI-powered sentiment analysis for single item
   - Input: source_type, source_id, text_content
   - Uses: OpenAI/Anthropic via AI SDK
   - Output: sentiment_score, label, keywords, entities

9. **`bulk-analyze-sentiment`** - Batch process unanalyzed items
   - Processes: feedback comments, form responses, social mentions
   - Rate-limited for API efficiency

#### Segmentation
10. **`calculate-segment-membership`** - Evaluate segment criteria for all customers
    - Supports: behavioral (events), demographic (person data), RFM
    - Creates/updates segment memberships

11. **`refresh-all-segments`** - Daily recalculation of active segments

#### Scoring
12. **`calculate-nps-scores`** - Compute NPS from feedback ratings
    - Maps 1-5 rating to 0-10 NPS scale
    - Calculates: % Promoters - % Detractors

13. **`calculate-engagement-scores`** - Weighted engagement calculation
    - Weights: purchase (10), feedback (5), form (3), social (5), pageview (1)
    - Stores per-person engagement score

14. **`calculate-churn-risk`** - AI-driven churn prediction
    - Inputs: engagement trend, sentiment, recency, frequency
    - Output: risk score 0-100

15. **`calculate-clv`** - Customer Lifetime Value estimation
    - Formula: avg_order_value × purchase_frequency × retention_period

#### Journey Tracking
16. **`track-customer-journey-event`** - Add event to customer timeline
    - Triggered by: form.submitted, feedback.created, order.placed, lead.created
    - Links visitor_id → person_id when possible

17. **`link-person-interactions`** - Unify anonymous visitor with known person
    - Triggered when: form email matches existing person
    - Backfills journey events from visitor sessions

---

## 4. Event Subscribers

### Ad Planning Subscribers
| Event | Action |
|-------|--------|
| `analytics_event.created` | Check conversion goals, create conversion |
| `lead.created` | Track lead conversion with attribution |
| `order.placed` | Track purchase conversion with order value |

### Consumer Insights Subscribers (NEW)
| Event | Action |
|-------|--------|
| `feedback.created` | Trigger sentiment analysis, add to journey |
| `form_response.created` | Trigger sentiment analysis (if text), add to journey, link to person |
| `order.placed` | Add to customer journey, recalculate CLV |
| `lead.created` | Link to person, add to journey |
| `person.created` | Initialize engagement score |

---

## 5. Scheduled Jobs

### Ad Planning Jobs
| Job | Schedule | Purpose |
|-----|----------|---------|
| `resolve-attributions` | Daily 2 AM | Batch resolve unattributed sessions |
| `generate-forecasts` | Weekly Sunday | Generate budget forecasts for active campaigns |
| `update-experiment-results` | Hourly | Recalculate A/B test results |

### Consumer Insights Jobs (NEW)
| Job | Schedule | Purpose |
|-----|----------|---------|
| `refresh-segments` | Daily 3 AM | Recalculate all active segment memberships |
| `bulk-sentiment-analysis` | Every 4 hours | Analyze unprocessed feedback/forms |
| `calculate-engagement-scores` | Daily 4 AM | Update engagement scores for all customers |
| `calculate-churn-risk` | Weekly Monday | AI-driven churn prediction for all customers |
| `aggregate-nps` | Daily 5 AM | Calculate daily NPS snapshots |

---

## 6. Module Links

### Ad Planning Links
- `AnalyticsSession` ↔ `AdCampaign` (read-only, via ad_campaign_id)
- `Lead` ↔ `AdCampaign` (via resolved_campaign_id)
- `Conversion` ↔ `AnalyticsSession`
- `Conversion` ↔ `Order`

### Consumer Insights Links (NEW)
- `CustomerScore` ↔ `Person` (via person_id)
- `CustomerJourney` ↔ `Person` (via person_id)
- `CustomerSegment` ↔ `Person` (many-to-many via segment_members)
- `SentimentAnalysis` ↔ `Feedback` (via source_id when source_type=feedback)
- `SentimentAnalysis` ↔ `FormResponse` (via source_id when source_type=form_response)

---

## 7. Updates to Existing Models

### `AnalyticsSession` (add fields)
```typescript
ad_campaign_id: model.text().nullable()
attribution_resolved: model.boolean().default(false)
```

### `Lead` (add field if missing)
```typescript
resolved_campaign_id: model.text().nullable()
```

### `Feedback` (add fields for insights)
```typescript
sentiment_score: model.float().nullable()       // -1 to 1
sentiment_label: model.text().nullable()        // positive/negative/neutral
person_id: model.text().nullable()              // link to Person if known
```

### `Person` (add fields for insights)
```typescript
engagement_score: model.float().default(0)      // computed engagement
last_interaction_at: model.dateTime().nullable() // for recency tracking
```

---

## 8. Implementation Order

### Phase 1: Core Module (First)
1. Create `src/modules/ad-planning/` structure
2. Add models: Conversion, ConversionGoal, CampaignAttribution
3. Create AdPlanningService
4. Register module in `medusa-config.ts`
5. Generate and run migrations

### Phase 2: Attribution System
1. Create `attribution-resolver.ts` utility
2. Implement resolve-session-attribution workflow
3. Add bulk-resolve-attributions workflow
4. Create scheduled job for daily resolution

### Phase 3: Conversion Tracking
1. Create conversion goal CRUD endpoints
2. Implement track-conversion workflow
3. Add event subscribers (analytics_event, lead, order)
4. Create `/web/ad-planning/track-conversion` endpoint

### Phase 4: A/B Testing & Forecasting
1. Add ABExperiment model and endpoints
2. Implement statistical utilities
3. Add BudgetForecast model and endpoints
4. Create forecast generation workflow

### Phase 5: Dashboard
1. Create dashboard API endpoints
2. Add ROI calculation logic
3. Implement trend analysis

---

## Consumer Insights Phases (NEW)

### Phase 6: Sentiment Analysis
1. Add SentimentAnalysis model
2. Create `analyze-sentiment` workflow using AI SDK
3. Add sentiment fields to Feedback model
4. Create event subscriber for feedback.created
5. Build sentiment API endpoints
6. Create bulk-sentiment-analysis scheduled job

### Phase 7: Customer Segmentation
1. Add CustomerSegment model + segment_members junction table
2. Create segmentation engine utility (rules evaluation)
3. Implement `calculate-segment-membership` workflow
4. Build segment CRUD endpoints
5. Create `refresh-segments` scheduled job

### Phase 8: Scoring & NPS
1. Add CustomerScore model
2. Create NPS calculation workflow (map 1-5 → 0-10)
3. Create engagement scoring workflow
4. Build NPS and scoring endpoints
5. Add scheduled jobs for score calculations

### Phase 9: Customer Journey & Unified View
1. Add CustomerJourney model
2. Create `track-customer-journey-event` workflow
3. Add event subscribers for all touchpoints
4. Build journey timeline endpoints
5. Create unified customer profile endpoint

### Phase 10: Predictive Analytics
1. Implement churn risk prediction workflow (AI-powered)
2. Implement CLV calculation workflow
3. Build at-risk customers endpoint
4. Create weekly churn prediction job

### Phase 11: Google Ads Integration (Future)
1. Create Google Ads provider service
2. OAuth flow for Google Ads API
3. Campaign/AdGroup/Ad sync similar to Meta
4. Unified attribution across platforms

---

## 9. Files to Create

```
src/modules/ad-planning/
├── index.ts                    # Module export
├── service.ts                  # AdPlanningService
├── models/
│   ├── conversion.ts
│   ├── conversion-goal.ts
│   ├── campaign-attribution.ts
│   ├── ab-experiment.ts
│   ├── budget-forecast.ts
│   ├── customer-segment.ts          # NEW
│   ├── customer-score.ts            # NEW
│   ├── sentiment-analysis.ts        # NEW
│   └── customer-journey.ts          # NEW
├── types/
│   └── index.ts
└── utils/
    ├── attribution-resolver.ts
    ├── statistical-utils.ts
    ├── forecast-engine.ts
    ├── segmentation-engine.ts       # NEW - rules evaluation
    ├── sentiment-analyzer.ts        # NEW - AI integration
    └── scoring-engine.ts            # NEW - engagement/NPS/CLV

src/api/admin/ad-planning/
├── attribution/route.ts
├── conversions/route.ts
├── goals/[id]/route.ts
├── goals/route.ts
├── experiments/[id]/route.ts
├── experiments/route.ts
├── forecasts/route.ts
├── dashboard/route.ts
├── segments/route.ts                # NEW
├── segments/[id]/route.ts           # NEW
├── segments/[id]/members/route.ts   # NEW
├── sentiment/route.ts               # NEW
├── sentiment/stats/route.ts         # NEW
├── nps/route.ts                     # NEW
├── scores/route.ts                  # NEW
├── scores/person/[id]/route.ts      # NEW
├── journey/person/[id]/route.ts     # NEW
├── journey/funnel/route.ts          # NEW
├── customers/[id]/profile/route.ts  # NEW
└── customers/at-risk/route.ts       # NEW

src/api/web/ad-planning/
└── track-conversion/route.ts

src/workflows/ad-planning/
├── attribution/
│   ├── resolve-session-attribution.ts
│   └── bulk-resolve-attributions.ts
├── conversions/
│   ├── track-conversion.ts
│   ├── track-purchase-conversion.ts
│   └── track-lead-conversion.ts
├── forecasting/
│   └── generate-budget-forecast.ts
├── experiments/
│   └── calculate-experiment-results.ts
├── sentiment/                       # NEW
│   ├── analyze-sentiment.ts
│   └── bulk-analyze-sentiment.ts
├── segmentation/                    # NEW
│   ├── calculate-segment-membership.ts
│   └── refresh-all-segments.ts
├── scoring/                         # NEW
│   ├── calculate-nps-scores.ts
│   ├── calculate-engagement-scores.ts
│   ├── calculate-churn-risk.ts
│   └── calculate-clv.ts
└── journey/                         # NEW
    ├── track-customer-journey-event.ts
    └── link-person-interactions.ts

src/subscribers/ad-planning/
├── analytics-event-created.ts
├── lead-created.ts
├── order-placed.ts
├── feedback-created.ts              # NEW
├── form-response-created.ts         # NEW
└── person-created.ts                # NEW

src/jobs/
├── resolve-attributions-job.ts
├── generate-forecasts-job.ts
├── update-experiment-results-job.ts
├── refresh-segments-job.ts          # NEW
├── bulk-sentiment-analysis-job.ts   # NEW
├── calculate-engagement-scores-job.ts # NEW
├── calculate-churn-risk-job.ts      # NEW
└── aggregate-nps-job.ts             # NEW

src/links/
├── analytics-session-campaign.ts
├── lead-campaign.ts
├── conversion-session.ts
├── conversion-order.ts
├── customer-score-person.ts         # NEW
├── customer-journey-person.ts       # NEW
├── segment-person.ts                # NEW
├── sentiment-feedback.ts            # NEW
└── sentiment-form-response.ts       # NEW
```

---

## 10. Verification

### After Phase 1 (Module Setup)
```bash
# Run migrations
npx medusa migrations generate ad_planning
npx medusa migrations run

# Verify module loads
yarn dev
# Check logs for "ad_planning" module registration
```

### After Phase 3 (Conversion Tracking)
```bash
# Create a conversion goal via API
curl -X POST http://localhost:9000/admin/ad-planning/goals \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"name": "Purchase", "goal_type": "purchase"}'

# Simulate an order and verify conversion is created
# Check database: SELECT * FROM conversion WHERE conversion_type = 'purchase'
```

### Integration Test
```bash
TEST_TYPE=integration:http jest --testPathPattern="ad-planning"
```

---

## 11. Key Reference Files

- `src/modules/socials/models/AdCampaign.ts` - Model pattern
- `src/modules/custom-analytics/models/analytics-event.ts` - Analytics model
- `src/modules/socials/service.ts` - Service pattern
- `src/api/admin/meta-ads/` - API route patterns

---

## 12. Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                   AD PLANNING & CONSUMER INSIGHTS PLATFORM                   │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ═══════════════════════════ DATA SOURCES ═══════════════════════════       │
│                                                                              │
│  ┌────────────┐ ┌────────────┐ ┌────────────┐ ┌────────────┐ ┌──────────┐  │
│  │ Meta Ads   │ │ Analytics  │ │ Forms &    │ │ Feedback   │ │ Social   │  │
│  │ (campaigns)│ │ (sessions) │ │ Leads      │ │ (ratings)  │ │ (posts)  │  │
│  └─────┬──────┘ └─────┬──────┘ └─────┬──────┘ └─────┬──────┘ └────┬─────┘  │
│        │              │              │              │             │         │
│        └──────────────┼──────────────┼──────────────┼─────────────┘         │
│                       ▼              ▼              ▼                        │
│  ═══════════════ UNIFIED CUSTOMER VIEW (Person Module) ═══════════════      │
│                                                                              │
│        ┌──────────────────────────────────────────────────────┐             │
│        │  Person Record                                        │             │
│        │  ├── Interactions: forms, feedback, orders, leads     │             │
│        │  ├── Engagement Score                                 │             │
│        │  ├── NPS Score                                        │             │
│        │  ├── Churn Risk                                       │             │
│        │  └── Segment Memberships                              │             │
│        └──────────────────────────────────────────────────────┘             │
│                       │                                                      │
│        ┌──────────────┼──────────────┐                                      │
│        ▼              ▼              ▼                                       │
│  ═════════════════ INTELLIGENCE LAYER ═════════════════                     │
│                                                                              │
│  ┌────────────┐ ┌────────────┐ ┌────────────┐ ┌────────────┐               │
│  │ Sentiment  │ │ Segment-   │ │ Scoring    │ │ Attribution│               │
│  │ Analysis   │ │ ation      │ │ Engine     │ │ Resolver   │               │
│  │ (AI)       │ │ Engine     │ │ (NPS/CLV)  │ │ (UTM→Camp) │               │
│  └─────┬──────┘ └─────┬──────┘ └─────┬──────┘ └─────┬──────┘               │
│        │              │              │              │                        │
│        └──────────────┼──────────────┼──────────────┘                        │
│                       ▼              ▼                                       │
│  ══════════════════ OUTPUT LAYER ══════════════════                         │
│                                                                              │
│  ┌────────────┐ ┌────────────┐ ┌────────────┐ ┌────────────┐ ┌──────────┐  │
│  │ ROI        │ │ Customer   │ │ Churn      │ │ A/B Test   │ │ Budget   │  │
│  │ Dashboard  │ │ Journey    │ │ Prediction │ │ Results    │ │ Forecast │  │
│  └────────────┘ └────────────┘ └────────────┘ └────────────┘ └──────────┘  │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

## 13. Data Flow Summary

```
Form Submit ──┐
Feedback ─────┤
Order ────────┼──▶ Customer Journey ──▶ Engagement Score ──▶ Segmentation
Lead ─────────┤                                │
Pageview ─────┘                                ▼
                                         Churn Prediction
                                               │
Ad Click ──▶ UTM Params ──▶ Attribution ──▶ Conversion ──▶ ROI Calculation
                                               │
                                               ▼
                                    Campaign Performance Dashboard
```
