---
title: "Ad Planning & Attribution - Usage Guide"
sidebar_label: "Usage Guide"
sidebar_position: 1
---

# Ad Planning & Attribution - Usage Guide

**Date**: 2026-03-25
**Status**: Production Ready
**Last Updated**: 2026-03-25 — Major bug fixes, automation improvements, and UI enhancements

A comprehensive guide to using the Ad Planning & Attribution module in the JYT Commerce admin dashboard. This module connects your Meta ad campaigns, social content, lead pipeline, and customer data into a unified planning and analytics system.

---

## Table of Contents

1. [Getting Started](#1-getting-started)
2. [Dashboard Overview](#2-dashboard-overview)
3. [Metrics Modal](#3-metrics-modal)
4. [Conversions](#4-conversions)
5. [A/B Experiments](#5-ab-experiments)
6. [Customer Journeys](#6-customer-journeys)
7. [Customer Segments](#7-customer-segments)
8. [Customer Scores](#8-customer-scores)
9. [Campaign Attribution](#9-campaign-attribution)
10. [Meta Ads Integration](#10-meta-ads-integration)
11. [API Reference](#11-api-reference)

---

## 1. Getting Started

### Accessing Ad Planning

Navigate to **Ad Planning** in the admin sidebar, or go directly to:

```
http://localhost:9000/app/ad-planning
```

The module is organized into seven sub-pages accessible from the main dashboard:

| Page | Path | Purpose |
|------|------|---------|
| Conversions | `/ad-planning/conversions` | Track and analyze conversion events |
| A/B Experiments | `/ad-planning/experiments` | Create and manage A/B tests |
| Customer Journeys | `/ad-planning/journeys` | Visualize customer touchpoints and funnel |
| Customer Segments | `/ad-planning/segments` | Create and manage audience segments |
| Customer Scores | `/ad-planning/scores` | CLV, engagement scores, and churn risk |
| Attribution | `/ad-planning/attribution` | Campaign attribution analysis |
| Metrics | `/ad-planning/metrics` | Consolidated metrics overview (modal) |

### Prerequisites

- Meta Ads accounts should be synced via `/meta-ads/` for full integration
- Social posts should be managed via `/social-posts/` for content metrics
- Analytics tracking should be active on your storefront for conversion and journey data

---

## 2. Dashboard Overview

The Ad Planning dashboard (`/ad-planning`) shows live KPI summary cards and quick-navigation links to each module. Use the **View Metrics** button in the top-right to open the consolidated metrics modal.

### Live KPI Cards

Six real-time metrics are displayed at the top of the dashboard:

| Metric | Description |
|--------|-------------|
| **Conversions** | Total conversion count (all time) |
| **Revenue** | Total conversion value |
| **Active Segments** | Count of active segments with total member count |
| **Experiments** | Count of currently running experiments |
| **Attribution Rate** | Percentage of sessions successfully attributed to campaigns |
| **Scored Customers** | Total customers with at least one computed score |

### Navigation Cards

Below the KPIs, six cards link to each sub-page. Cards include contextual badges (e.g., "3 running" for experiments, "5 active" for segments) so you can quickly gauge activity without clicking through.

```
┌────────────────────────────────────────────────────┐
│  Ad Planning & Attribution          [View Metrics] │
├────────────────────────────────────────────────────┤
│  [Conversions: 1,204] [Revenue: ₹4.5L] [Segments] │
│  [Experiments: 2]     [Attr Rate: 78%] [Scored: 89]│
├────────────────────────────────────────────────────┤
│  ┌──────────────┐  ┌──────────────┐  ┌──────────┐ │
│  │ Conversions  │  │ A/B Tests    │  │ Journeys │ │
│  │  ✓ 1,204     │  │  ● 2 running │  │          │ │
│  └──────────────┘  └──────────────┘  └──────────┘ │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────┐ │
│  │ Segments     │  │ Scores       │  │ Attrib.  │ │
│  │  ● 5 active  │  │              │  │          │ │
│  └──────────────┘  └──────────────┘  └──────────┘ │
└────────────────────────────────────────────────────┘
```

---

## 3. Metrics Modal

Click **View Metrics** to open a full-screen modal with consolidated KPIs across all modules.

### Overview KPIs

Six headline metrics appear at the top:

| Metric | Source | Description |
|--------|--------|-------------|
| **Ad Spend** | Meta Ads campaigns | Total spend across all synced campaigns |
| **Total Revenue** | Conversion events | Sum of all conversion values |
| **Total Conversions** | Conversion events | Count of all tracked conversions |
| **Total Leads** | Meta Ads leads | Count of leads captured from lead forms |
| **Social Posts** | Social posts | Count of posts with "posted" status |
| **ROAS** | Computed | Return on Ad Spend = Revenue / Ad Spend. Green when >= 1x, red when < 1x |

### Meta Ads Performance

Shows six key ad metrics pulled from `/admin/meta-ads/campaigns/totals`:

- **Spend** - Total campaign spend
- **Impressions** - Total ad impressions
- **Clicks** - Total ad clicks
- **Leads** - Leads generated from ads
- **CTR** - Click-through rate
- **ROAS** - Return on ad spend

Below these metrics, the **top 3 campaigns** (by spend) are listed with their name, spend, clicks, leads, and status badge. Click any campaign to navigate to its detail page.

### Social Content & Lead Pipeline

Displayed side-by-side:

**Social Content** shows post counts by status:
- Posted, Scheduled, Drafts, Failed
- Recent posted items with dates and captions

**Lead Pipeline** shows leads by status:
- New, Contacted, Qualified, Converted
- A visual pipeline bar showing proportional distribution
- **Top Campaigns by Leads** - breakdown of which campaigns generated the most leads

### Additional Sections

- **Conversions Breakdown** - Purchases, Lead Forms, Add to Cart, Begin Checkout
- **Customer Funnel** - Bar chart showing journey stages (awareness → advocacy) with drop-off rates
- **A/B Experiments** - Running, Completed, Total counts with recent experiments list
- **Customer Scores** - Total scored, Avg CLV, Avg Engagement, High Churn Risk with tier distribution
- **Customer Segments** - Total, Active, Dynamic counts with member totals
- **Campaign Attribution** - Attribution count, Conversions, Conversion Rate with source breakdown

---

## 4. Conversions

**Path**: `/ad-planning/conversions`

Track every conversion event that happens across your channels.

### Conversion Types

| Type | Description |
|------|-------------|
| `purchase` | A completed order |
| `lead_form_submission` | A form submission (contact, quote request, etc.) |
| `add_to_cart` | Product added to cart |
| `begin_checkout` | Checkout process started |
| `scroll_depth` | User scrolled past a threshold |
| `time_on_site` | User spent significant time on site |

### Summary Cards

Four KPI cards appear above the data table:

| Card | Description |
|------|-------------|
| **Total Conversions** | Count of all conversion events |
| **Total Value** | Sum of all conversion values |
| **Purchases** | Count of purchase-type conversions |
| **Avg Value** | Average value per conversion |

### Viewing Conversions

The list page shows a DataTable with columns:
- **Type** - Color-coded badge (green for purchase, blue for lead form, etc.)
- **Value** - Conversion value with currency
- **Order** - Clickable link to the order detail page (for purchase conversions)
- **Campaign** - UTM campaign name, links to the attribution page filtered by that campaign
- **Customer** - Person ID (links to their journey timeline) or anonymous visitor ID
- **Platform** - Where the conversion occurred (meta, google, direct)
- **Date** - When the conversion happened

Use the **type filter** dropdown to narrow down to specific conversion types.

### Creating Conversions via API

Conversions are typically created automatically by your storefront tracking, but can also be created manually:

```bash
curl -X POST /admin/ad-planning/conversions \
  -H "Content-Type: application/json" \
  -d '{
    "visitor_id": "vis_abc123",
    "conversion_type": "purchase",
    "conversion_value": 4999,
    "currency": "INR",
    "order_id": "order_xyz",
    "utm_source": "facebook",
    "utm_campaign": "summer_sale"
  }'
```

### Conversion Stats

The stats endpoint provides aggregated data:

```
GET /admin/ad-planning/conversions/stats
```

Returns: `total_conversions`, `total_value`, `conversion_rate`, and `by_type` breakdown.

---

## 5. A/B Experiments

**Path**: `/ad-planning/experiments`

Create and manage A/B tests to optimize ad creatives, landing pages, audiences, and budgets.

### Experiment Lifecycle

```
Draft → Running → Completed
          ↓
        Paused
```

1. **Create** an experiment (status: `draft`)
2. **Start** the experiment (status: `running`)
3. Wait for statistical significance or **Stop** manually
4. View results and **winner recommendation**

### Creating an Experiment

Click **Create Experiment** to open the creation modal:

| Field | Description | Example |
|-------|-------------|---------|
| Name | Descriptive name | "Summer Banner vs Winter Banner" |
| Description | What you're testing | "Testing seasonal creative performance" |
| Type | What's being tested | `ad_creative`, `landing_page`, `audience`, `budget`, `bidding` |
| Primary Metric | What to measure | `conversion_rate`, `ctr`, `cpc`, `roas`, `leads`, `revenue` |
| Confidence Level | Statistical confidence threshold | `0.95` (95%) |
| Target Sample Size | Minimum samples before concluding | `1000` |

### Experiment Detail Page

Navigate to an experiment by clicking its name. The detail page shows:

**Main Column**:
- General information (type, metric, description)
- Variants section showing control and treatment with their traffic split percentages
- Results section with:
  - Control vs Treatment metric values
  - Statistical significance indicator
  - Lift percentage
  - P-value
  - Winner and recommendation

**Sidebar**:
- **Sample Progress** (running/completed) — Progress bar showing current samples vs target sample size, with control/treatment split. Bar turns green when target is reached.
- Timeline (created, started, ended dates)
- Statistical significance badge
- P-value and improvement percentage

### Actions

| Action | Available When | What It Does |
|--------|---------------|--------------|
| Edit | Draft | Edit experiment name and description |
| Start | Draft | Begins the experiment, starts collecting data |
| Stop | Running | Ends the experiment, calculates final results |
| Delete | Draft | Removes the experiment entirely |

---

## 6. Customer Journeys

**Path**: `/ad-planning/journeys`

Visualize every customer touchpoint across all channels.

### Journey Stages

The funnel progresses through these stages:

```
Awareness → Interest → Consideration → Intent → Conversion → Retention → Advocacy
```

### Event Types

| Event | Description | Badge Color |
|-------|-------------|-------------|
| `page_view` | Visited a page | Grey |
| `ad_click` | Clicked an ad | Purple |
| `lead_capture` | Submitted a lead form | Orange |
| `form_submit` | Submitted any form | Blue |
| `purchase` | Completed a purchase | Green |
| `social_engage` | Engaged on social media | Grey |

### Funnel Visualization

At the top of the journeys page, a **visual funnel chart** shows stage-by-stage progression:

- Horizontal bars proportional to the number of visitors at each stage
- **Drop-off percentages** shown at each transition
- **Overall conversion rate** badge (awareness → conversion)
- **Biggest drop-off** highlighted below the funnel
- Includes both **identified customers** (with person_id) and **anonymous visitors** (visitor_id only)

### Filtering

Below the funnel, the event log table has two filter dropdowns:
- **Stage filter** - Show only events at a specific funnel stage
- **Event type filter** - Show only specific event types

### Cross-links

- **Customer column** — Person IDs link to their full journey timeline at `/ad-planning/journeys/{personId}`
- **Order column** — For purchase events, links directly to the order detail page

---

## 7. Customer Segments

**Path**: `/ad-planning/segments`

Create rule-based customer segments for targeting and analysis.

### Segment Types

| Type | Description | Example |
|------|-------------|---------|
| `behavioral` | Based on customer actions | "Purchased 3+ times in 30 days" |
| `demographic` | Based on customer attributes | "Located in Mumbai, age > 25" |
| `rfm` | Recency, Frequency, Monetary analysis | "High frequency buyers with recent activity" |
| `custom` | Custom rule combinations | Any criteria combination |

### Creating a Segment

Click **Create Segment** to open the creation modal:

1. Enter a **Name** and **Description**
2. Select the **Segment Type**
3. Build **Rules** using the criteria builder:
   - Each rule has a **Field**, **Operator**, and **Value**
   - Click **+ Add Rule** to add more conditions
   - Rules are combined with AND/OR logic
4. Click **Create** to save

Example rules:
```
Field: "total_orders"  Operator: "greater_than"  Value: "5"
AND
Field: "last_order_date"  Operator: "within_days"  Value: "30"
```

### Segment Detail Page

Click a segment name to view its detail page (`/ad-planning/segments/{id}`):

**Main Column**:
- General info (type, status, member count, dates)
- Criteria section showing all rules
- Members table (email, name, phone, date added)

**Sidebar**:
- Quick summary stats
- **Rebuild** button - recalculates membership based on current rules
- **Delete** button

### Dynamic vs Static Segments

- **Dynamic** (`auto_update: true`) - Membership is automatically rebuilt after purchase events. When a customer makes a purchase, all active auto-update segments are recalculated with the latest scores and data.
- **Static** - Members are fixed until manually rebuilt via the **Rebuild** button on the segment detail page.

### Manual Members

Members added manually (`added_reason: "manual"`) are preserved during segment rebuilds. Only rule-matched members are removed when they no longer meet the criteria.

---

## 8. Customer Scores

**Path**: `/ad-planning/scores`

View computed customer scores including CLV, engagement, churn risk, and NPS.

### Score Types

| Score | Range | Display | Description |
|-------|-------|---------|-------------|
| **CLV** (Customer Lifetime Value) | ₹0+ | Currency | Predicted lifetime revenue from this customer |
| **Engagement** | 0-100 | Numeric | How actively the customer interacts |
| **Churn Risk** | 0-100% | Percentage | Probability of customer leaving. Red > 70%, Yellow > 40%, Green < 40% |
| **NPS** | -100 to 100 | Numeric | Net Promoter Score |

### Tiers

Customers are grouped into tiers based on their scores:

| Tier | Badge | Description |
|------|-------|-------------|
| Platinum | Green | Top-tier customers |
| Gold | Blue | High-value customers |
| Silver | Orange | Mid-tier customers |
| Bronze | Grey | Entry-level customers |

### Filtering

Use the **Score Type** dropdown to filter by: CLV, Engagement, Churn Risk, NPS.

### Automatic Score Recalculation

Scores are automatically recalculated after key events:

| Event | Scores Updated |
|-------|---------------|
| **Purchase** (`order.placed`) | CLV (full prediction), Engagement, Churn Risk |
| **Feedback** (`feedback.created`) | Engagement (full recalc), NPS (if rating provided) |
| **Sentiment analysis** | Engagement (full recalc) |

This means scores stay fresh without manual intervention. The purchase workflow resolves the customer's `person_id` from their order email, then recalculates all three scores and rebuilds auto-update segments.

### Calculating Scores via API

Scores can also be triggered manually via the API. All four score types are supported:

```bash
# Calculate NPS for a customer
curl -X POST /admin/ad-planning/scores \
  -d '{"person_id": "person_abc", "score_type": "nps", "rating": 9, "scale": "10"}'

# Calculate engagement score
curl -X POST /admin/ad-planning/scores \
  -d '{"person_id": "person_abc", "score_type": "engagement"}'

# Calculate predicted CLV
curl -X POST /admin/ad-planning/scores \
  -d '{"person_id": "person_abc", "score_type": "clv"}'

# Calculate churn risk
curl -X POST /admin/ad-planning/scores \
  -d '{"person_id": "person_abc", "score_type": "churn_risk"}'
```

---

## 9. Campaign Attribution

**Path**: `/ad-planning/attribution`

Track which campaigns and channels drive conversions using multi-touch attribution models.

### Attribution Resolution

Attribution works by matching UTM parameters from analytics sessions to known ad campaigns. Resolution happens in two ways:

1. **Automatic** — When an analytics event arrives with `utm_campaign` data, attribution is resolved immediately via the event subscriber.
2. **Manual bulk resolve** — Click **Resolve Attributions** to process any remaining unresolved sessions.

### Table Columns

The attribution list shows:

- **Campaign** - UTM campaign name with UTM source
- **Source** - Color-coded badge (Google = blue, Facebook/Instagram/Meta = purple, Email = green)
- **Medium** - UTM medium (cpc, social, email, etc.)
- **Platform** - Ad platform (meta, google, generic)
- **Resolved** - Yes/No badge indicating whether the session was matched to a campaign
- **Method** - How the match was made (exact UTM match, fuzzy name match)
- **Pageviews** - Number of pages viewed in the session
- **Ad Spend** - Campaign spend from Meta Ads (enriched data)
- **Date** - Attribution date

### Filtering

Use the status dropdown to filter by:
- **All Attributions** — Show everything
- **Resolved** — Only sessions matched to campaigns
- **Unresolved** — Sessions that couldn't be matched

### Bulk Resolve

Click **Resolve Attributions** to trigger bulk resolution of unresolved attributions. This process:

1. Finds all unresolved attribution records
2. Matches UTM parameters to known Meta Ad campaigns
3. Links the attribution to the correct campaign using exact or fuzzy name matching
4. Updates the `is_resolved` flag and `resolution_method`

Resolution methods:
- `exact_utm_match` - UTM campaign exactly matches a campaign name
- `fuzzy_name_match` - Partial name match found
- `manual` - Manually assigned
- `unresolved` - No match found

---

## 10. Meta Ads Integration

The Ad Planning module pulls data from your connected Meta Ads accounts to provide:

### Data Flow

```
Meta Business Suite
        │
        ▼ (Sync)
┌───────────────────┐
│   Socials Module   │
│  ┌─────────────┐  │
│  │ AdCampaigns │  │
│  │ AdSets      │  │
│  │ Ads         │  │
│  │ Leads       │  │
│  │ AdInsights  │  │
│  └─────────────┘  │
└────────┬──────────┘
         │ (FK links)
         ▼
┌───────────────────┐
│ Ad Planning Module │
│  ┌─────────────┐  │
│  │ Conversions │──── ad_campaign_id, ad_set_id, ad_id
│  │ Attribution │──── ad_campaign_id, utm_campaign
│  │ Journeys    │──── ad_campaign_id
│  │ Forecasts   │──── campaign_id
│  └─────────────┘  │
└───────────────────┘
```

### Syncing Data

Before using ad-planning metrics, ensure your Meta data is synced:

1. Go to **Meta Ads** > **Campaigns** (`/meta-ads/campaigns`)
2. Click **Sync Campaigns** to pull latest data from Meta
3. Go to **Meta Ads** > **Leads** (`/meta-ads/leads`)
4. Click **Sync Leads** to pull latest lead data

### What Gets Connected

| Ad Planning Feature | Meta Ads Data Used |
|--------------------|--------------------|
| Metrics ROAS | Campaign spend vs conversion revenue |
| Attribution enrichment | Campaign spend shown alongside attributed conversions |
| Lead Pipeline | Leads grouped by campaign_name for source tracking |
| Conversion tracking | Conversions linked to specific campaigns, ad sets, and ads |
| Customer journeys | Ad clicks tracked as journey events |

---

## 11. API Reference

### Conversions

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/admin/ad-planning/conversions` | List conversions (filters: `conversion_type`, `platform`, `from_date`, `to_date`) |
| POST | `/admin/ad-planning/conversions` | Create a conversion event |
| GET | `/admin/ad-planning/conversions/stats` | Get conversion statistics and breakdowns |

### Experiments

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/admin/ad-planning/experiments` | List experiments (filters: `status`) |
| POST | `/admin/ad-planning/experiments` | Create an experiment |
| GET | `/admin/ad-planning/experiments/:id` | Get experiment details |
| POST | `/admin/ad-planning/experiments/:id/start` | Start an experiment |
| POST | `/admin/ad-planning/experiments/:id/stop` | Stop an experiment |
| DELETE | `/admin/ad-planning/experiments/:id` | Delete a draft experiment |
| GET | `/admin/ad-planning/experiments/:id/results` | Get experiment results |

### Segments

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/admin/ad-planning/segments` | List segments (filters: `segment_type`, `is_active`) |
| POST | `/admin/ad-planning/segments` | Create a segment with rules |
| GET | `/admin/ad-planning/segments/:id` | Get segment details |
| PUT | `/admin/ad-planning/segments/:id` | Update segment (pass `rebuild: true` to trigger rebuild) |
| DELETE | `/admin/ad-planning/segments/:id` | Delete a segment |
| GET | `/admin/ad-planning/segments/:id/members` | List segment members |

### Journeys

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/admin/ad-planning/journeys` | List journey events (filters: `person_id`, `event_type`, `stage`) |
| POST | `/admin/ad-planning/journeys` | Create a journey event |
| GET | `/admin/ad-planning/journeys/funnel` | Get funnel analysis by stage |
| GET | `/admin/ad-planning/journeys/:personId` | Get journey for a specific person |

### Scores

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/admin/ad-planning/scores` | List scores with aggregates (filters: `score_type`, `person_id`) |
| POST | `/admin/ad-planning/scores` | Calculate a score (`score_type`: nps, engagement, clv, churn_risk) |

### Attribution

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/admin/ad-planning/attribution` | List attributions (filters: `platform`, `is_resolved`) |
| POST | `/admin/ad-planning/attribution/resolve` | Resolve attributions (single or bulk with `bulk: true`) |
| GET | `/admin/ad-planning/attribution/stats` | Get attribution statistics |

### Goals

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/admin/ad-planning/goals` | List conversion goals |
| POST | `/admin/ad-planning/goals` | Create a conversion goal |
| GET | `/admin/ad-planning/goals/:id` | Get goal details |
| DELETE | `/admin/ad-planning/goals/:id` | Delete a goal |

### Additional Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/admin/ad-planning/dashboard` | Dashboard summary data |
| GET | `/admin/ad-planning/nps` | NPS scores |
| GET | `/admin/ad-planning/sentiment` | Sentiment analysis with top keywords, emotions, entities, topics |
| GET | `/admin/ad-planning/predictive` | Predictive scores |
| GET | `/admin/ad-planning/predictive/at-risk` | At-risk customers |
| GET | `/admin/ad-planning/forecasts` | Budget forecasts |
| GET | `/admin/ad-planning/forecasts/accuracy` | Forecast accuracy metrics |

---

## Common Workflows

### Track a Campaign End-to-End

1. **Sync Meta campaigns** via `/meta-ads/campaigns` > Sync
2. **Create a conversion goal** (e.g., "Purchase with value > ₹500")
3. **Monitor conversions** as they come in at `/ad-planning/conversions`
4. **Resolve attributions** to link conversions back to campaigns
5. **View ROAS** in the metrics modal to see which campaigns are profitable

### Run an A/B Test

1. Go to `/ad-planning/experiments` > **Create Experiment**
2. Set up control and treatment variants
3. Click **Start** to begin the test
4. Monitor results on the experiment detail page
5. When significance is reached, review the winner and recommendation
6. **Stop** the experiment and apply the winning variant

### Build a Customer Segment

1. Go to `/ad-planning/segments` > **Create Segment**
2. Define rules (e.g., "total_orders > 5 AND last_order within 30 days")
3. Save the segment
4. Use **Rebuild** to recalculate membership
5. View members on the segment detail page

### Analyze the Customer Funnel

1. Open the **Metrics modal** via the dashboard
2. Scroll to the **Customer Funnel** section
3. Review drop-off rates between stages (awareness → conversion)
4. Use `/ad-planning/journeys` to drill into specific stages
5. Filter by event type to understand which touchpoints work best

### Monitor Lead Pipeline

1. Sync leads via `/meta-ads/leads` > Sync
2. Open the **Metrics modal**
3. Review the **Lead Pipeline** section for status distribution
4. Check **Top Campaigns by Leads** to see which campaigns drive leads
5. Use lead status tracking (new → contacted → qualified → converted)
