# Meta Ads & Leads Integration Plan

## Overview

This document outlines the plan to integrate Meta Marketing API for managing Facebook/Instagram Ads and syncing Leads directly from the JYT platform.

## Current State Analysis

### Existing Infrastructure ✅

We already have a solid foundation:

1. **Socials Module** (`src/modules/socials/`)
   - `SocialPlatform` model - stores OAuth credentials and API config
   - `SocialPost` model - stores posts with insights
   - `PublishingCampaign` model - automated publishing campaigns
   - Services for hashtags, mentions, content generation, insights

2. **Social Provider Module** (`src/modules/social-provider/`)
   - `FacebookService` - OAuth, page management, post publishing
   - `InstagramService` - Instagram publishing via Facebook API
   - `ContentPublishingService` - unified publishing orchestration
   - Already using Facebook Graph API v24.0

3. **Webhooks** (`src/api/webhooks/social/facebook/`)
   - Webhook verification and signature validation
   - Event processing for post insights

4. **OAuth Flow**
   - Complete Facebook OAuth implementation
   - Page access token management
   - Scope management (pages, instagram permissions)

---

## What We Need to Add

### 1. New Permissions (OAuth Scopes)

Add to existing Facebook OAuth flow:

```
ads_read              - Read ad account data
ads_management        - Create/manage ads
leads_retrieval       - Retrieve lead data from lead ads
pages_manage_ads      - Manage ads for Pages
business_management   - Manage business assets
```

### 2. New Data Models

#### AdAccount Model
```typescript
const AdAccount = model.define("AdAccount", {
  id: model.id().primaryKey(),
  
  // Meta identifiers
  meta_account_id: model.text().unique(),  // act_123456789
  name: model.text().searchable(),
  
  // Account details
  currency: model.text().default("USD"),
  timezone: model.text().nullable(),
  business_name: model.text().nullable(),
  
  // Status
  status: model.enum(["active", "disabled", "pending"]).default("active"),
  account_status: model.number().nullable(), // Meta's status code
  
  // Spending
  amount_spent: model.bigNumber().default(0),
  spend_cap: model.bigNumber().nullable(),
  balance: model.bigNumber().nullable(),
  
  // Sync metadata
  last_synced_at: model.dateTime().nullable(),
  sync_status: model.enum(["synced", "syncing", "error"]).default("synced"),
  
  // Relationships
  platform: model.belongsTo(() => SocialPlatform, { foreignKey: "platform_id" }),
  campaigns: model.hasMany(() => AdCampaign, { mappedBy: "ad_account" }),
  
  metadata: model.json().nullable(),
})
```

#### AdCampaign Model
```typescript
const AdCampaign = model.define("AdCampaign", {
  id: model.id().primaryKey(),
  
  // Meta identifiers
  meta_campaign_id: model.text().unique(),
  name: model.text().searchable(),
  
  // Campaign config
  objective: model.enum([
    "OUTCOME_AWARENESS",
    "OUTCOME_ENGAGEMENT", 
    "OUTCOME_LEADS",
    "OUTCOME_SALES",
    "OUTCOME_TRAFFIC",
    "OUTCOME_APP_PROMOTION"
  ]),
  status: model.enum(["ACTIVE", "PAUSED", "DELETED", "ARCHIVED"]).default("PAUSED"),
  effective_status: model.text().nullable(),
  
  // Budget
  buying_type: model.enum(["AUCTION", "RESERVED"]).default("AUCTION"),
  daily_budget: model.bigNumber().nullable(),
  lifetime_budget: model.bigNumber().nullable(),
  budget_remaining: model.bigNumber().nullable(),
  
  // Schedule
  start_time: model.dateTime().nullable(),
  stop_time: model.dateTime().nullable(),
  
  // Performance (synced from insights)
  impressions: model.bigNumber().default(0),
  clicks: model.bigNumber().default(0),
  spend: model.bigNumber().default(0),
  leads: model.bigNumber().default(0),
  
  // Sync
  last_synced_at: model.dateTime().nullable(),
  
  // Relationships
  ad_account: model.belongsTo(() => AdAccount, { foreignKey: "ad_account_id" }),
  ad_sets: model.hasMany(() => AdSet, { mappedBy: "campaign" }),
  
  metadata: model.json().nullable(),
})
```

#### AdSet Model
```typescript
const AdSet = model.define("AdSet", {
  id: model.id().primaryKey(),
  
  // Meta identifiers
  meta_adset_id: model.text().unique(),
  name: model.text().searchable(),
  
  // Status
  status: model.enum(["ACTIVE", "PAUSED", "DELETED", "ARCHIVED"]).default("PAUSED"),
  effective_status: model.text().nullable(),
  
  // Budget & Bidding
  daily_budget: model.bigNumber().nullable(),
  lifetime_budget: model.bigNumber().nullable(),
  bid_amount: model.bigNumber().nullable(),
  billing_event: model.enum(["IMPRESSIONS", "LINK_CLICKS", "APP_INSTALLS"]).default("IMPRESSIONS"),
  optimization_goal: model.text().nullable(),
  
  // Targeting (JSON - complex structure)
  targeting: model.json().nullable(),
  
  // Schedule
  start_time: model.dateTime().nullable(),
  end_time: model.dateTime().nullable(),
  
  // Performance
  impressions: model.bigNumber().default(0),
  clicks: model.bigNumber().default(0),
  spend: model.bigNumber().default(0),
  leads: model.bigNumber().default(0),
  
  // Relationships
  campaign: model.belongsTo(() => AdCampaign, { foreignKey: "campaign_id" }),
  ads: model.hasMany(() => Ad, { mappedBy: "ad_set" }),
  
  metadata: model.json().nullable(),
})
```

#### Ad Model
```typescript
const Ad = model.define("Ad", {
  id: model.id().primaryKey(),
  
  // Meta identifiers
  meta_ad_id: model.text().unique(),
  name: model.text().searchable(),
  
  // Status
  status: model.enum(["ACTIVE", "PAUSED", "DELETED", "ARCHIVED"]).default("PAUSED"),
  effective_status: model.text().nullable(),
  
  // Creative
  creative_id: model.text().nullable(),
  preview_url: model.text().nullable(),
  
  // Performance
  impressions: model.bigNumber().default(0),
  clicks: model.bigNumber().default(0),
  spend: model.bigNumber().default(0),
  leads: model.bigNumber().default(0),
  ctr: model.float().nullable(),
  cpc: model.float().nullable(),
  cpm: model.float().nullable(),
  
  // Relationships
  ad_set: model.belongsTo(() => AdSet, { foreignKey: "ad_set_id" }),
  
  metadata: model.json().nullable(),
})
```

#### LeadForm Model
```typescript
const LeadForm = model.define("LeadForm", {
  id: model.id().primaryKey(),
  
  // Meta identifiers
  meta_form_id: model.text().unique(),
  name: model.text().searchable(),
  
  // Form config
  status: model.enum(["ACTIVE", "ARCHIVED", "DELETED"]).default("ACTIVE"),
  locale: model.text().nullable(),
  
  // Form structure (JSON)
  questions: model.json().nullable(),  // Array of form fields
  privacy_policy_url: model.text().nullable(),
  thank_you_page_url: model.text().nullable(),
  
  // Stats
  leads_count: model.number().default(0),
  
  // Relationships
  page_id: model.text(),  // Facebook Page ID
  ad_account: model.belongsTo(() => AdAccount, { foreignKey: "ad_account_id" }),
  leads: model.hasMany(() => Lead, { mappedBy: "lead_form" }),
  
  metadata: model.json().nullable(),
})
```

#### Lead Model (Core - Most Important!)
```typescript
const Lead = model.define("Lead", {
  id: model.id().primaryKey(),
  
  // Meta identifiers
  meta_lead_id: model.text().unique(),
  
  // Lead data
  email: model.text().nullable(),
  phone: model.text().nullable(),
  full_name: model.text().nullable(),
  first_name: model.text().nullable(),
  last_name: model.text().nullable(),
  
  // Additional fields (from form)
  field_data: model.json().nullable(),  // All form responses
  
  // Source tracking
  ad_id: model.text().nullable(),
  ad_name: model.text().nullable(),
  adset_id: model.text().nullable(),
  adset_name: model.text().nullable(),
  campaign_id: model.text().nullable(),
  campaign_name: model.text().nullable(),
  form_id: model.text().nullable(),
  
  // Timestamps
  created_time: model.dateTime(),  // When lead was submitted
  
  // Processing status
  status: model.enum([
    "new",           // Just received
    "contacted",     // Reached out
    "qualified",     // Qualified lead
    "converted",     // Became customer
    "disqualified",  // Not a fit
    "archived"       // Archived
  ]).default("new"),
  
  // Internal tracking
  notes: model.text().nullable(),
  assigned_to: model.text().nullable(),  // User ID
  contacted_at: model.dateTime().nullable(),
  converted_at: model.dateTime().nullable(),
  
  // Relationships
  lead_form: model.belongsTo(() => LeadForm, { foreignKey: "lead_form_id" }),
  platform: model.belongsTo(() => SocialPlatform, { foreignKey: "platform_id" }),
  
  // Link to Person module (optional)
  person_id: model.text().nullable(),
  
  metadata: model.json().nullable(),
})
```

---

### 3. Meta Marketing API Service

Create `src/modules/social-provider/meta-ads-service.ts`:

```typescript
export default class MetaAdsService {
  private readonly API_VERSION = "v24.0"
  
  // ============ AD ACCOUNTS ============
  
  /** List ad accounts accessible by the user */
  async listAdAccounts(userAccessToken: string): Promise<AdAccountData[]>
  
  /** Get ad account details */
  async getAdAccount(accountId: string, accessToken: string): Promise<AdAccountData>
  
  // ============ CAMPAIGNS ============
  
  /** List campaigns for an ad account */
  async listCampaigns(accountId: string, accessToken: string): Promise<CampaignData[]>
  
  /** Create a new campaign */
  async createCampaign(accountId: string, data: CreateCampaignInput, accessToken: string): Promise<CampaignData>
  
  /** Update campaign (status, budget, etc.) */
  async updateCampaign(campaignId: string, data: UpdateCampaignInput, accessToken: string): Promise<CampaignData>
  
  /** Pause/Resume campaign */
  async setCampaignStatus(campaignId: string, status: "ACTIVE" | "PAUSED", accessToken: string): Promise<void>
  
  // ============ AD SETS ============
  
  /** List ad sets for a campaign */
  async listAdSets(campaignId: string, accessToken: string): Promise<AdSetData[]>
  
  /** Create ad set with targeting */
  async createAdSet(campaignId: string, data: CreateAdSetInput, accessToken: string): Promise<AdSetData>
  
  /** Update ad set */
  async updateAdSet(adSetId: string, data: UpdateAdSetInput, accessToken: string): Promise<AdSetData>
  
  // ============ ADS ============
  
  /** List ads for an ad set */
  async listAds(adSetId: string, accessToken: string): Promise<AdData[]>
  
  /** Create ad with creative */
  async createAd(adSetId: string, data: CreateAdInput, accessToken: string): Promise<AdData>
  
  // ============ LEAD FORMS ============
  
  /** List lead forms for a page */
  async listLeadForms(pageId: string, accessToken: string): Promise<LeadFormData[]>
  
  /** Get lead form details */
  async getLeadForm(formId: string, accessToken: string): Promise<LeadFormData>
  
  // ============ LEADS ============
  
  /** Retrieve leads from a form (bulk) */
  async getLeads(formId: string, accessToken: string, options?: {
    since?: Date
    until?: Date
    limit?: number
  }): Promise<LeadData[]>
  
  /** Get single lead details */
  async getLead(leadId: string, accessToken: string): Promise<LeadData>
  
  // ============ INSIGHTS ============
  
  /** Get insights for ad account/campaign/adset/ad */
  async getInsights(objectId: string, level: "account" | "campaign" | "adset" | "ad", accessToken: string, options?: {
    date_preset?: string
    time_increment?: number
    fields?: string[]
    breakdowns?: string[]
  }): Promise<InsightsData>
}
```

---

### 4. Lead Ads Webhook Handler

Extend existing webhook infrastructure:

**File**: `src/api/webhooks/social/facebook/leadgen/route.ts`

```typescript
// Webhook for leadgen events
// Facebook sends: { object: "page", entry: [{ changes: [{ field: "leadgen", value: {...} }] }] }

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  // 1. Validate signature
  // 2. Parse leadgen event
  // 3. Fetch full lead data from API
  // 4. Store in Lead model
  // 5. Trigger notification workflow
  // 6. Return 200 OK immediately
}
```

**Webhook Event Structure**:
```json
{
  "object": "page",
  "entry": [{
    "id": "PAGE_ID",
    "time": 1234567890,
    "changes": [{
      "field": "leadgen",
      "value": {
        "leadgen_id": "LEAD_ID",
        "page_id": "PAGE_ID",
        "form_id": "FORM_ID",
        "adgroup_id": "AD_ID",
        "ad_id": "AD_ID",
        "created_time": 1234567890
      }
    }]
  }]
}
```

---

### 5. API Routes

#### Ad Accounts
```
GET    /admin/meta-ads/accounts              - List connected ad accounts
POST   /admin/meta-ads/accounts/sync         - Sync ad accounts from Meta
GET    /admin/meta-ads/accounts/:id          - Get account details
GET    /admin/meta-ads/accounts/:id/insights - Get account insights
```

#### Campaigns
```
GET    /admin/meta-ads/campaigns             - List all campaigns
POST   /admin/meta-ads/campaigns             - Create campaign
GET    /admin/meta-ads/campaigns/:id         - Get campaign details
PATCH  /admin/meta-ads/campaigns/:id         - Update campaign
POST   /admin/meta-ads/campaigns/:id/pause   - Pause campaign
POST   /admin/meta-ads/campaigns/:id/resume  - Resume campaign
GET    /admin/meta-ads/campaigns/:id/insights - Get campaign insights
POST   /admin/meta-ads/campaigns/sync        - Sync campaigns from Meta
```

#### Ad Sets
```
GET    /admin/meta-ads/adsets                - List all ad sets
POST   /admin/meta-ads/adsets                - Create ad set
GET    /admin/meta-ads/adsets/:id            - Get ad set details
PATCH  /admin/meta-ads/adsets/:id            - Update ad set
GET    /admin/meta-ads/adsets/:id/insights   - Get ad set insights
```

#### Ads
```
GET    /admin/meta-ads/ads                   - List all ads
POST   /admin/meta-ads/ads                   - Create ad
GET    /admin/meta-ads/ads/:id               - Get ad details
PATCH  /admin/meta-ads/ads/:id               - Update ad
GET    /admin/meta-ads/ads/:id/insights      - Get ad insights
```

#### Lead Forms
```
GET    /admin/meta-ads/lead-forms            - List lead forms
GET    /admin/meta-ads/lead-forms/:id        - Get form details
POST   /admin/meta-ads/lead-forms/sync       - Sync forms from Meta
```

#### Leads (Most Important!)
```
GET    /admin/meta-ads/leads                 - List all leads (with filters)
GET    /admin/meta-ads/leads/:id             - Get lead details
PATCH  /admin/meta-ads/leads/:id             - Update lead status/notes
POST   /admin/meta-ads/leads/:id/convert     - Mark as converted
POST   /admin/meta-ads/leads/sync            - Sync leads from Meta
POST   /admin/meta-ads/leads/export          - Export leads to CSV
```

---

### 6. Workflows

#### Sync Ad Account Workflow
```typescript
// Syncs ad account data, campaigns, ad sets, ads from Meta
export const syncAdAccountWorkflow = createWorkflow(...)
```

#### Process Lead Workflow
```typescript
// Triggered by webhook or manual sync
// 1. Fetch full lead data
// 2. Store in database
// 3. Create Person record (optional)
// 4. Send notification
// 5. Trigger automation (email, CRM sync)
export const processLeadWorkflow = createWorkflow(...)
```

#### Sync Insights Workflow
```typescript
// Scheduled job to sync performance data
export const syncAdsInsightsWorkflow = createWorkflow(...)
```

---

### 7. Admin UI Components

#### Meta Ads Dashboard
- Overview of all ad accounts
- Performance metrics (spend, leads, conversions)
- Quick actions (pause/resume campaigns)

#### Campaigns List
- DataTable with campaigns
- Status badges
- Performance columns
- Bulk actions

#### Leads Management (Priority!)
- Leads list with filters (status, date, campaign, form)
- Lead detail view
- Status workflow (new → contacted → qualified → converted)
- Notes and activity log
- Export functionality
- Link to Person module

#### Lead Form Viewer
- View form structure
- See questions/fields
- Lead count per form

---

## Implementation Phases

### Phase 1: Foundation (Week 1)
1. ✅ Update OAuth scopes for ads permissions
2. Create new data models (AdAccount, Campaign, AdSet, Ad, LeadForm, Lead)
3. Run migrations
4. Create MetaAdsService with basic methods

### Phase 2: Leads Integration (Week 2) - PRIORITY
1. Implement Lead webhook handler
2. Create leads API routes
3. Build leads sync workflow
4. Create leads admin UI

### Phase 3: Ads Management (Week 3)
1. Implement campaign/adset/ad sync
2. Create ads management API routes
3. Build ads admin UI
4. Implement insights sync

### Phase 4: Advanced Features (Week 4)
1. Scheduled insights sync job
2. Lead automation workflows
3. Person module integration
4. Export/reporting features

---

## Required Environment Variables

```bash
# Existing (already have)
FACEBOOK_CLIENT_ID=your_app_id
FACEBOOK_CLIENT_SECRET=your_app_secret
FACEBOOK_WEBHOOK_VERIFY_TOKEN=your_verify_token

# New (add to existing)
# No new env vars needed - uses same Facebook app
# Just need to add new OAuth scopes
```

---

## OAuth Scope Update

Update `src/modules/social-provider/facebook-service.ts`:

```typescript
// Current scope
const defaultScope = "pages_show_list,pages_manage_posts,pages_read_engagement,instagram_basic,instagram_content_publish,instagram_manage_comments,instagram_manage_insights,instagram_manage_messages";

// New scope (add ads permissions)
const defaultScope = "pages_show_list,pages_manage_posts,pages_read_engagement,instagram_basic,instagram_content_publish,instagram_manage_comments,instagram_manage_insights,instagram_manage_messages,ads_read,ads_management,leads_retrieval,pages_manage_ads,business_management";
```

---

## Webhook Subscription Update

In Facebook App Dashboard, add subscription for:
- **Object**: `page`
- **Field**: `leadgen` (for lead ads)

---

## Data Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                         META ADS PLATFORM                            │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐            │
│  │ Campaigns│  │ Ad Sets  │  │   Ads    │  │  Leads   │            │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘            │
└───────┼─────────────┼─────────────┼─────────────┼──────────────────┘
        │             │             │             │
        │  Sync API   │             │   Webhook   │
        ▼             ▼             ▼             ▼
┌─────────────────────────────────────────────────────────────────────┐
│                         JYT PLATFORM                                 │
│                                                                      │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                    MetaAdsService                            │   │
│  │  • listAdAccounts()  • getInsights()  • getLeads()          │   │
│  │  • syncCampaigns()   • createAd()     • processLead()       │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                              │                                       │
│                              ▼                                       │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                    Data Models                               │   │
│  │  AdAccount → Campaign → AdSet → Ad                          │   │
│  │  LeadForm → Lead → Person (optional link)                   │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                              │                                       │
│                              ▼                                       │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                    Admin UI                                  │   │
│  │  • Ads Dashboard    • Leads List    • Campaign Manager      │   │
│  │  • Insights Charts  • Lead Details  • Export/Reports        │   │
│  └─────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Success Metrics

1. **Lead Capture**: All leads from Meta ads synced in real-time
2. **Lead Management**: Full workflow from new → converted
3. **Ads Visibility**: View all campaigns, ad sets, ads in one place
4. **Performance Tracking**: Insights synced and displayed
5. **Automation**: Leads automatically create Person records

---

## Next Steps

1. **Approve this plan** - Review and confirm approach
2. **Start Phase 1** - Create models and service
3. **Priority: Leads** - Focus on lead capture first
4. **Iterate** - Add features based on usage

---

## References

- [Meta Marketing API Documentation](https://developers.facebook.com/docs/marketing-api/)
- [Lead Ads API Guide](https://developers.facebook.com/docs/marketing-api/guides/lead-ads/)
- [Webhooks for Lead Ads](https://developers.facebook.com/docs/marketing-api/guides/lead-ads/retrieving/)
- [Insights API](https://developers.facebook.com/docs/marketing-api/insights/)
