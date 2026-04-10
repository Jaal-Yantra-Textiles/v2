---
title: "Ad Planning - Data Flow & Architecture"
sidebar_label: "Data Flow"
sidebar_position: 1
---

# Ad Planning — Data Flow & Architecture

Reference for how data flows through the ad-planning module: from event ingestion to score calculation to segment membership.

_Last updated: 2026-04-10_

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                      Event Sources                              │
├──────────┬───────────┬────────────┬─────────────┬──────────────┤
│ Storefront│ Meta Ads  │ Feedback   │ Lead Forms  │ order.placed │
│ Analytics │ Insights  │ Module     │             │              │
└────┬─────┴─────┬─────┴─────┬──────┴──────┬──────┴──────┬───────┘
     │           │           │             │             │
     ▼           ▼           ▼             ▼             ▼
 ┌────────┐  ┌────────┐  ┌────────┐  ┌────────┐  ┌──────────────┐
 │Analytics│  │Insights│  │Sentiment│  │Lead    │  │Purchase      │
 │Event   │  │Sync    │  │Analysis │  │Convert │  │Conversion    │
 │Tracking│  │Job     │  │Workflow │  │Workflow│  │Workflow      │
 └───┬────┘  └───┬────┘  └───┬────┘  └───┬────┘  └──────┬───────┘
     │           │           │            │              │
     ▼           ▼           ▼            ▼              ▼
 ┌───────────────────────────────────────────────────────────────┐
 │                    AD-PLANNING MODULE                          │
 │                                                               │
 │  ┌────────────┐  ┌──────────────┐  ┌──────────────────────┐  │
 │  │ Conversion │  │ Campaign     │  │ CustomerScore         │  │
 │  │ (purchase, │  │ Attribution  │  │ (CLV, engagement,     │  │
 │  │  lead, etc)│  │ (UTM→camp)  │  │  churn, NPS)          │  │
 │  └──────┬─────┘  └──────┬───────┘  └──────────┬───────────┘  │
 │         │               │                      │              │
 │  ┌──────▼───────────────▼──────────────────────▼───────────┐  │
 │  │             Segment Evaluation Engine                    │  │
 │  │  Enriched customer data → criteria rules → membership   │  │
 │  └─────────────────────────┬───────────────────────────────┘  │
 │                            │                                  │
 │  ┌─────────────────────────▼──────────────────────────────┐   │
 │  │  CustomerSegment → SegmentMember → Dashboard/API       │   │
 │  └────────────────────────────────────────────────────────┘   │
 └───────────────────────────────────────────────────────────────┘
```

---

## Purchase Conversion Flow

When an order is placed, the `trackPurchaseConversionWorkflow` runs 8 steps:

```
order.placed event
  │
  ▼
1. fetchOrderStep          ─── query.graph("order") for computed total
  │
  ▼
2. resolvePersonStep       ─── match order email → Person record
  │
  ▼
3. findAttributionStep     ─── session → person's visitor_ids → CampaignAttribution
  │
  ▼
4. createPurchaseConversion ─── write Conversion record (conversion_value = order.total)
  │
  ▼
5. recalculateCLVStep      ─── full CLV prediction from purchase history
  │
  ▼
6. addPurchaseJourneyStep  ─── add CustomerJourney "purchase" event
  │
  ▼
7. recalculateEngagement   ─── activity-weighted engagement score
  │
  ▼
8. recalculateChurnRisk    ─── weighted risk (activity + purchase + engagement + sentiment)
  │
  ▼
9. rebuildAutoSegments     ─── rebuild all active auto-update segments
```

### Attribution Scoping

The `findAttributionStep` resolves attribution for a purchase in this order:

1. **Session-based**: If `session_id` is provided, look up `CampaignAttribution` by `analytics_session_id`
2. **Person-based (last-touch)**: Look up this person's historical `visitor_ids` from their `Conversion` records, then find the most recent resolved `CampaignAttribution` for those visitors
3. **Unattributed**: Fall through with `platform: "generic"`, `attribution_method: "unattributed"`

:::caution
Previously step 2 fetched ALL system-wide attributions and assigned the most recent one — leaking attribution across customers. Fixed in April 2026.
:::

---

## Segment Evaluation

When a segment is built (via API rebuild or the weekly `rebuild-segments-job`), the `buildSegmentWorkflow` runs:

### Enriched Customer Data Object

Each person is enriched with data from multiple sources:

| Field | Source | Description |
|---|---|---|
| `total_orders` | Medusa Order module (via customer email match) | Lifetime order count |
| `total_spent` | Ad-planning Conversion records (purchase type) | Sum of conversion_value for paid purchases |
| `avg_order_value` | Computed: `total_spent / paidPurchases.length` | Excludes €0 draft orders |
| `days_since_last_order` | Latest purchase conversion `converted_at` | Days elapsed |
| `total_purchases` | Ad-planning Conversion count (purchase type) | May differ from `total_orders` if not all orders have conversions |
| `total_conversions` | All Conversion count for this person | Includes non-purchase types |
| `nps_score` | CustomerScore (type: nps) | -100 to 100 |
| `engagement_score` | CustomerScore (type: engagement) | 0 to 100 |
| `clv` / `clv_score` | CustomerScore (type: clv) | Monetary CLV prediction |
| `churn_risk` | CustomerScore (type: churn_risk) | 0 to 100 (higher = more at-risk) |
| `age` | Person `date_of_birth` | Computed at evaluation time |
| `country` / `city` / `state` | PersonAddress | First address for this person |
| `customer_since_days` | Medusa Customer `created_at` | Days since account creation |
| `has_account` | Medusa Customer | Boolean |
| `tags` | Person tags | Array of tag names |

### Criteria Evaluation

Rules support these operators:

| Operator | Description | Numeric Coercion |
|---|---|---|
| `>=`, `<=`, `>`, `<` | Numeric comparison | ✅ String values coerced via `Number()` |
| `==`, `!=` | Equality (loose) | No |
| `contains`, `not_contains` | String substring match | No |
| `in`, `not_in` | Array membership | No |
| `between` | Range (inclusive) | ✅ |
| `within_last_days` | Date within N days | Date parsing |
| `older_than_days` | Date older than N days | Date parsing |

Logic groups: `AND` (all rules), `OR` (any rule), `NOT` (none match)

---

## Score Calculations

### CLV (Customer Lifetime Value)

```
averageOrderValue = totalRevenue / purchaseCount
monthlyFrequency  = purchaseCount / lifespanMonths
predictedCLV      = averageOrderValue × monthlyFrequency × adjustedLifespan
remainingCLV      = max(0, predictedCLV - totalRevenue)
```

Lifespan adjustments:
- Default: 24 months
- High frequency (avg < 90 days between purchases): 36 months
- Single purchase: 12 months, frequency set to 1/3 per month
- Low frequency (avg > 180 days): 6 months

Tiers: platinum (≥50k), gold (≥20k), silver (≥5k), bronze

### Engagement Score

Activity-weighted with time decay:

| Activity | Base Weight |
|---|---|
| Purchase | 25 + `log10(value+1) × 2` bonus |
| Lead form submission | 15 |
| Feedback | 10 |
| Page engagement | 5 |
| Add to cart | 8 |
| Begin checkout | 12 |
| Other | 3 |

Time decay: `1.0 - (daysAgo / 365)` clamped to `[0.1, 1.0]`
Normalized: `min(100, round(totalScore / 5))`

### Churn Risk

Weighted components (sum to 1.0):

| Factor | Weight | Formula |
|---|---|---|
| Activity inactivity | 0.35 | `min(1, daysSinceActivity / 90)` |
| Purchase inactivity | 0.30 | `min(1, daysSincePurchase / 180)` |
| Engagement decline | 0.20 | `min(1, max(0, engagementDecline / 100))` |
| Negative sentiment | 0.15 | `min(1, negativeWeight / recentSentiments.length)` |

Negative sentiment weights: `"very_negative"` = 1.5, `"negative"` = 1.0

### NPS (Net Promoter Score)

Standard NPS: `((promoters - detractors) / total) × 100`

5-point scale classification (from raw rating):
- 5 → promoter
- 4 → passive
- 1-3 → detractor

10-point scale (standard):
- 9-10 → promoter
- 7-8 → passive
- 0-6 → detractor

---

## Currency Handling

| Data | Currency Source |
|---|---|
| `conversion.conversion_value` | `order.currency_code` (from Medusa order) |
| `conversion.currency` | Nullable — set from order or null for non-purchase conversions |
| Meta Ads `campaign.spend` | Ad account currency (typically INR for Indian accounts) |
| Dashboard ROI | Revenue (store currency) vs spend (ad account currency) — UI converts via exchange rate |

The admin UI's `useCurrencyFormatter("INR")` hook fetches a live exchange rate from the Frankfurter API (ECB data, cached 1 hour) and converts ad spend to the store's default currency before displaying.

---

## Scheduled Jobs

| Job | Schedule | What it does |
|---|---|---|
| `recalculate-customer-scores` | `0 3 * * 0` (Sunday 3 AM) | Recalculates engagement, CLV, churn risk for customers with activity in last 30 days |
| `resolve-attributions` | `0 2 * * *` (Daily 2 AM) | Bulk-resolves unattributed sessions from the last 7 days (up to 5000 per run) |
| `rebuild-segments` | `0 4 * * 1` (Monday 4 AM) | Rebuilds all active auto-update segments |

---

## Key API Endpoints

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/admin/ad-planning/dashboard` | Dashboard overview with KPIs, trends, campaign ROI |
| GET | `/admin/ad-planning/conversions/stats` | Aggregated conversion statistics with time series |
| GET | `/admin/ad-planning/attribution/stats` | Attribution resolution stats |
| GET | `/admin/ad-planning/experiments` | List A/B experiments (filterable by status, experiment_type) |
| GET | `/admin/ad-planning/experiments/:id/results` | Statistical results for an experiment |
| GET | `/admin/ad-planning/scores` | Customer scores with person name, percentile, tier |
| GET | `/admin/ad-planning/segments/:id` | Segment detail with member count |
| POST | `/admin/ad-planning/segments/:id` | Rebuild segment with `{ rebuild: true }` |
| GET | `/admin/ad-planning/journeys/:personId` | Customer journey timeline |
| GET | `/admin/ad-planning/journeys/funnel` | Funnel analysis |
| GET | `/admin/exchange-rate?from=INR&to=EUR` | Live exchange rate (Frankfurter/ECB) |
