import { MedusaError } from "@medusajs/utils"

/**
 * MetaAdsService
 * 
 * Service for interacting with Meta Marketing API.
 * Handles ad accounts, campaigns, ad sets, ads, lead forms, and leads.
 */

// ============ TYPES ============

export interface AdAccountData {
  id: string
  account_id: string
  name: string
  currency: string
  timezone_name?: string
  business_name?: string
  business?: { id: string; name: string }
  account_status: number
  disable_reason?: number
  amount_spent: string
  spend_cap?: string
  balance?: string
  min_daily_budget?: number
}

export interface CampaignData {
  id: string
  name: string
  objective: string
  status: string
  effective_status: string
  configured_status?: string
  buying_type: string
  daily_budget?: string
  lifetime_budget?: string
  budget_remaining?: string
  special_ad_categories?: string[]
  start_time?: string
  stop_time?: string
}

export interface AdSetData {
  id: string
  name: string
  campaign_id: string
  status: string
  effective_status: string
  daily_budget?: string
  lifetime_budget?: string
  budget_remaining?: string
  bid_amount?: string
  bid_strategy?: string
  billing_event: string
  optimization_goal?: string
  targeting?: Record<string, any>
  start_time?: string
  end_time?: string
}

export interface AdData {
  id: string
  name: string
  adset_id: string
  status: string
  effective_status: string
  creative?: {
    id: string
    name?: string
    object_story_spec?: Record<string, any>
  }
  preview_shareable_link?: string
}

export interface LeadFormData {
  id: string
  name: string
  status: string
  locale?: string
  questions?: Array<{
    key: string
    type: string
    label?: string
  }>
  privacy_policy?: { url: string }
  thank_you_page?: { url: string }
  context_card?: Record<string, any>
  follow_up_action_url?: string
  leads_count?: number
  page_id?: string
}

export interface LeadData {
  id: string
  created_time: string
  ad_id?: string
  ad_name?: string
  adset_id?: string
  adset_name?: string
  campaign_id?: string
  campaign_name?: string
  form_id?: string
  field_data: Array<{
    name: string
    values: string[]
  }>
  retailer_item_id?: string
  is_organic?: boolean
  platform?: string
}

export interface InsightsData {
  data: Array<{
    impressions?: string
    clicks?: string
    spend?: string
    reach?: string
    actions?: Array<{ action_type: string; value: string }>
    cost_per_action_type?: Array<{ action_type: string; value: string }>
    cpc?: string
    cpm?: string
    ctr?: string
    date_start?: string
    date_stop?: string
  }>
  paging?: {
    cursors: { before: string; after: string }
    next?: string
  }
}

export interface CreateCampaignInput {
  name: string
  objective: string
  status?: "ACTIVE" | "PAUSED"
  special_ad_categories?: string[]
  daily_budget?: number
  lifetime_budget?: number
  start_time?: string
  stop_time?: string
}

export interface UpdateCampaignInput {
  name?: string
  status?: "ACTIVE" | "PAUSED"
  daily_budget?: number
  lifetime_budget?: number
  stop_time?: string
}

export interface CreateAdSetInput {
  name: string
  campaign_id: string
  daily_budget?: number
  lifetime_budget?: number
  bid_amount?: number
  billing_event: string
  optimization_goal: string
  targeting: Record<string, any>
  start_time?: string
  end_time?: string
  status?: "ACTIVE" | "PAUSED"
}

export interface UpdateAdSetInput {
  name?: string
  status?: "ACTIVE" | "PAUSED"
  daily_budget?: number
  lifetime_budget?: number
  bid_amount?: number
  targeting?: Record<string, any>
  end_time?: string
}

export interface CreateAdInput {
  name: string
  adset_id: string
  creative: {
    creative_id?: string
    // Or create new creative
    object_story_spec?: Record<string, any>
  }
  status?: "ACTIVE" | "PAUSED"
}

// ============ SERVICE ============

export default class MetaAdsService {
  private readonly API_VERSION = "v24.0"
  private readonly BASE_URL = "https://graph.facebook.com"

  /**
   * Make a request to the Meta Graph API
   */
  private async request<T>(
    endpoint: string,
    accessToken: string,
    options: {
      method?: "GET" | "POST" | "DELETE"
      params?: Record<string, any>
      body?: Record<string, any>
    } = {}
  ): Promise<T> {
    const { method = "GET", params = {}, body } = options
    
    const url = new URL(`${this.BASE_URL}/${this.API_VERSION}/${endpoint}`)
    url.searchParams.set("access_token", accessToken)
    
    // Add query params
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null) {
        url.searchParams.set(key, String(value))
      }
    }

    const fetchOptions: RequestInit = { method }
    
    if (body && method === "POST") {
      fetchOptions.headers = { "Content-Type": "application/json" }
      fetchOptions.body = JSON.stringify(body)
    }

    const response = await fetch(url.toString(), fetchOptions)
    
    if (!response.ok) {
      const error = await response.json().catch(() => ({}))
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `Meta API error: ${response.status} - ${JSON.stringify(error)}`
      )
    }

    return response.json()
  }

  // ============ AD ACCOUNTS ============

  /**
   * List ad accounts accessible by the user
   */
  async listAdAccounts(userAccessToken: string): Promise<AdAccountData[]> {
    const fields = [
      "id",
      "account_id",
      "name",
      "currency",
      "timezone_name",
      "business_name",
      "business{id,name}",
      "account_status",
      "disable_reason",
      "amount_spent",
      "spend_cap",
      "balance",
      "min_daily_budget",
    ].join(",")

    const response = await this.request<{ data: AdAccountData[] }>(
      "me/adaccounts",
      userAccessToken,
      { params: { fields, limit: 100 } }
    )

    return response.data || []
  }

  /**
   * Get ad account details
   */
  async getAdAccount(accountId: string, accessToken: string): Promise<AdAccountData> {
    const fields = [
      "id",
      "account_id",
      "name",
      "currency",
      "timezone_name",
      "business_name",
      "business{id,name}",
      "account_status",
      "disable_reason",
      "amount_spent",
      "spend_cap",
      "balance",
      "min_daily_budget",
    ].join(",")

    // Ensure account ID has act_ prefix
    const actId = accountId.startsWith("act_") ? accountId : `act_${accountId}`

    return this.request<AdAccountData>(actId, accessToken, { params: { fields } })
  }

  // ============ CAMPAIGNS ============

  /**
   * List campaigns for an ad account
   */
  async listCampaigns(
    accountId: string,
    accessToken: string,
    options: { limit?: number; status_filter?: string[] } = {}
  ): Promise<CampaignData[]> {
    const actId = accountId.startsWith("act_") ? accountId : `act_${accountId}`
    
    const fields = [
      "id",
      "name",
      "objective",
      "status",
      "effective_status",
      "configured_status",
      "buying_type",
      "daily_budget",
      "lifetime_budget",
      "budget_remaining",
      "special_ad_categories",
      "start_time",
      "stop_time",
    ].join(",")

    const params: Record<string, any> = {
      fields,
      limit: options.limit || 100,
    }

    if (options.status_filter) {
      params.filtering = JSON.stringify([
        { field: "effective_status", operator: "IN", value: options.status_filter }
      ])
    }

    const response = await this.request<{ data: CampaignData[] }>(
      `${actId}/campaigns`,
      accessToken,
      { params }
    )

    return response.data || []
  }

  /**
   * Get campaign details
   */
  async getCampaign(campaignId: string, accessToken: string): Promise<CampaignData> {
    const fields = [
      "id",
      "name",
      "objective",
      "status",
      "effective_status",
      "configured_status",
      "buying_type",
      "daily_budget",
      "lifetime_budget",
      "budget_remaining",
      "special_ad_categories",
      "start_time",
      "stop_time",
    ].join(",")

    return this.request<CampaignData>(campaignId, accessToken, { params: { fields } })
  }

  /**
   * Create a new campaign
   */
  async createCampaign(
    accountId: string,
    data: CreateCampaignInput,
    accessToken: string
  ): Promise<{ id: string }> {
    const actId = accountId.startsWith("act_") ? accountId : `act_${accountId}`

    const body: Record<string, any> = {
      name: data.name,
      objective: data.objective,
      status: data.status || "PAUSED",
      special_ad_categories: data.special_ad_categories || [],
    }

    if (data.daily_budget) body.daily_budget = data.daily_budget
    if (data.lifetime_budget) body.lifetime_budget = data.lifetime_budget
    if (data.start_time) body.start_time = data.start_time
    if (data.stop_time) body.stop_time = data.stop_time

    return this.request<{ id: string }>(
      `${actId}/campaigns`,
      accessToken,
      { method: "POST", body }
    )
  }

  /**
   * Update a campaign
   */
  async updateCampaign(
    campaignId: string,
    data: UpdateCampaignInput,
    accessToken: string
  ): Promise<{ success: boolean }> {
    const body: Record<string, any> = {}

    if (data.name) body.name = data.name
    if (data.status) body.status = data.status
    if (data.daily_budget) body.daily_budget = data.daily_budget
    if (data.lifetime_budget) body.lifetime_budget = data.lifetime_budget
    if (data.stop_time) body.stop_time = data.stop_time

    return this.request<{ success: boolean }>(
      campaignId,
      accessToken,
      { method: "POST", body }
    )
  }

  /**
   * Pause or resume a campaign
   */
  async setCampaignStatus(
    campaignId: string,
    status: "ACTIVE" | "PAUSED",
    accessToken: string
  ): Promise<{ success: boolean }> {
    return this.updateCampaign(campaignId, { status }, accessToken)
  }

  // ============ AD SETS ============

  /**
   * List ad sets for a campaign or account
   */
  async listAdSets(
    parentId: string,
    accessToken: string,
    options: { type?: "campaign" | "account"; limit?: number } = {}
  ): Promise<AdSetData[]> {
    const { type = "campaign", limit = 100 } = options
    
    let endpoint: string
    if (type === "account") {
      const actId = parentId.startsWith("act_") ? parentId : `act_${parentId}`
      endpoint = `${actId}/adsets`
    } else {
      endpoint = `${parentId}/adsets`
    }

    const fields = [
      "id",
      "name",
      "campaign_id",
      "status",
      "effective_status",
      "daily_budget",
      "lifetime_budget",
      "budget_remaining",
      "bid_amount",
      "bid_strategy",
      "billing_event",
      "optimization_goal",
      "targeting",
      "start_time",
      "end_time",
    ].join(",")

    const response = await this.request<{ data: AdSetData[] }>(
      endpoint,
      accessToken,
      { params: { fields, limit } }
    )

    return response.data || []
  }

  /**
   * Get ad set details
   */
  async getAdSet(adSetId: string, accessToken: string): Promise<AdSetData> {
    const fields = [
      "id",
      "name",
      "campaign_id",
      "status",
      "effective_status",
      "daily_budget",
      "lifetime_budget",
      "budget_remaining",
      "bid_amount",
      "bid_strategy",
      "billing_event",
      "optimization_goal",
      "targeting",
      "start_time",
      "end_time",
    ].join(",")

    return this.request<AdSetData>(adSetId, accessToken, { params: { fields } })
  }

  /**
   * Create an ad set
   */
  async createAdSet(
    accountId: string,
    data: CreateAdSetInput,
    accessToken: string
  ): Promise<{ id: string }> {
    const actId = accountId.startsWith("act_") ? accountId : `act_${accountId}`

    const body: Record<string, any> = {
      name: data.name,
      campaign_id: data.campaign_id,
      billing_event: data.billing_event,
      optimization_goal: data.optimization_goal,
      targeting: data.targeting,
      status: data.status || "PAUSED",
    }

    if (data.daily_budget) body.daily_budget = data.daily_budget
    if (data.lifetime_budget) body.lifetime_budget = data.lifetime_budget
    if (data.bid_amount) body.bid_amount = data.bid_amount
    if (data.start_time) body.start_time = data.start_time
    if (data.end_time) body.end_time = data.end_time

    return this.request<{ id: string }>(
      `${actId}/adsets`,
      accessToken,
      { method: "POST", body }
    )
  }

  /**
   * Update an ad set
   */
  async updateAdSet(
    adSetId: string,
    data: UpdateAdSetInput,
    accessToken: string
  ): Promise<{ success: boolean }> {
    const body: Record<string, any> = {}

    if (data.name) body.name = data.name
    if (data.status) body.status = data.status
    if (data.daily_budget) body.daily_budget = data.daily_budget
    if (data.lifetime_budget) body.lifetime_budget = data.lifetime_budget
    if (data.bid_amount) body.bid_amount = data.bid_amount
    if (data.targeting) body.targeting = data.targeting
    if (data.end_time) body.end_time = data.end_time

    return this.request<{ success: boolean }>(
      adSetId,
      accessToken,
      { method: "POST", body }
    )
  }

  // ============ ADS ============

  /**
   * List ads for an ad set or account
   */
  async listAds(
    parentId: string,
    accessToken: string,
    options: { type?: "adset" | "account"; limit?: number } = {}
  ): Promise<AdData[]> {
    const { type = "adset", limit = 100 } = options
    
    let endpoint: string
    if (type === "account") {
      const actId = parentId.startsWith("act_") ? parentId : `act_${parentId}`
      endpoint = `${actId}/ads`
    } else {
      endpoint = `${parentId}/ads`
    }

    const fields = [
      "id",
      "name",
      "adset_id",
      "status",
      "effective_status",
      "creative{id,name,object_story_spec}",
      "preview_shareable_link",
    ].join(",")

    const response = await this.request<{ data: AdData[] }>(
      endpoint,
      accessToken,
      { params: { fields, limit } }
    )

    return response.data || []
  }

  /**
   * Get ad details
   */
  async getAd(adId: string, accessToken: string): Promise<AdData> {
    const fields = [
      "id",
      "name",
      "adset_id",
      "status",
      "effective_status",
      "creative{id,name,object_story_spec}",
      "preview_shareable_link",
    ].join(",")

    return this.request<AdData>(adId, accessToken, { params: { fields } })
  }

  /**
   * Create an ad
   */
  async createAd(
    accountId: string,
    data: CreateAdInput,
    accessToken: string
  ): Promise<{ id: string }> {
    const actId = accountId.startsWith("act_") ? accountId : `act_${accountId}`

    const body: Record<string, any> = {
      name: data.name,
      adset_id: data.adset_id,
      status: data.status || "PAUSED",
    }

    if (data.creative.creative_id) {
      body.creative = { creative_id: data.creative.creative_id }
    } else if (data.creative.object_story_spec) {
      body.creative = { object_story_spec: data.creative.object_story_spec }
    }

    return this.request<{ id: string }>(
      `${actId}/ads`,
      accessToken,
      { method: "POST", body }
    )
  }

  // ============ LEAD FORMS ============

  /**
   * List lead forms for a page
   */
  async listLeadForms(pageId: string, accessToken: string): Promise<LeadFormData[]> {
    const fields = [
      "id",
      "name",
      "status",
      "locale",
      "questions",
      "privacy_policy",
      "thank_you_page",
      "context_card",
      "follow_up_action_url",
      "leads_count",
    ].join(",")

    const response = await this.request<{ data: LeadFormData[] }>(
      `${pageId}/leadgen_forms`,
      accessToken,
      { params: { fields, limit: 100 } }
    )

    return (response.data || []).map(form => ({
      ...form,
      page_id: pageId,
    }))
  }

  /**
   * Get lead form details
   */
  async getLeadForm(formId: string, accessToken: string): Promise<LeadFormData> {
    const fields = [
      "id",
      "name",
      "status",
      "locale",
      "questions",
      "privacy_policy",
      "thank_you_page",
      "context_card",
      "follow_up_action_url",
      "leads_count",
      "page{id,name}",
    ].join(",")

    return this.request<LeadFormData>(formId, accessToken, { params: { fields } })
  }

  // ============ LEADS ============

  /**
   * Retrieve leads from a form (bulk)
   */
  async getLeads(
    formId: string,
    accessToken: string,
    options: {
      since?: Date
      until?: Date
      limit?: number
      after?: string // Pagination cursor
    } = {}
  ): Promise<{ leads: LeadData[]; paging?: { next?: string; after?: string } }> {
    const fields = [
      "id",
      "created_time",
      "ad_id",
      "ad_name",
      "adset_id",
      "adset_name",
      "campaign_id",
      "campaign_name",
      "form_id",
      "field_data",
      "retailer_item_id",
      "is_organic",
      "platform",
    ].join(",")

    const params: Record<string, any> = {
      fields,
      limit: options.limit || 100,
    }

    // Add time filters
    if (options.since) {
      params.filtering = JSON.stringify([
        { field: "time_created", operator: "GREATER_THAN", value: Math.floor(options.since.getTime() / 1000) }
      ])
    }

    if (options.after) {
      params.after = options.after
    }

    const response = await this.request<{ data: LeadData[]; paging?: any }>(
      `${formId}/leads`,
      accessToken,
      { params }
    )

    return {
      leads: response.data || [],
      paging: response.paging ? {
        next: response.paging.next,
        after: response.paging.cursors?.after,
      } : undefined,
    }
  }

  /**
   * Get single lead details
   */
  async getLead(leadId: string, accessToken: string): Promise<LeadData> {
    const fields = [
      "id",
      "created_time",
      "ad_id",
      "ad_name",
      "adset_id",
      "adset_name",
      "campaign_id",
      "campaign_name",
      "form_id",
      "field_data",
      "retailer_item_id",
      "is_organic",
      "platform",
    ].join(",")

    return this.request<LeadData>(leadId, accessToken, { params: { fields } })
  }

  // ============ INSIGHTS ============

  /**
   * Get insights for ad account/campaign/adset/ad
   */
  async getInsights(
    objectId: string,
    accessToken: string,
    options: {
      level?: "account" | "campaign" | "adset" | "ad"
      date_preset?: string // today, yesterday, last_7d, last_30d, etc.
      time_range?: { since: string; until: string }
      time_increment?: number // 1 = daily, 7 = weekly, etc.
      fields?: string[]
      breakdowns?: string[]
      limit?: number
    } = {}
  ): Promise<InsightsData> {
    const defaultFields = [
      "impressions",
      "clicks",
      "spend",
      "reach",
      "actions",
      "cost_per_action_type",
      "cpc",
      "cpm",
      "ctr",
    ]

    const params: Record<string, any> = {
      fields: (options.fields || defaultFields).join(","),
      limit: options.limit || 100,
    }

    if (options.level) params.level = options.level
    if (options.date_preset) params.date_preset = options.date_preset
    if (options.time_range) params.time_range = JSON.stringify(options.time_range)
    if (options.time_increment) params.time_increment = options.time_increment
    if (options.breakdowns) params.breakdowns = options.breakdowns.join(",")

    // Handle account ID prefix
    let endpoint = objectId
    if (options.level === "account" && !objectId.startsWith("act_")) {
      endpoint = `act_${objectId}`
    }

    return this.request<InsightsData>(
      `${endpoint}/insights`,
      accessToken,
      { params }
    )
  }

  // ============ HELPER METHODS ============

  /**
   * Extract contact info from lead field_data
   */
  extractLeadContactInfo(fieldData: LeadData["field_data"]): {
    email?: string
    phone?: string
    full_name?: string
    first_name?: string
    last_name?: string
    company_name?: string
    job_title?: string
    city?: string
    state?: string
    country?: string
    zip_code?: string
  } {
    const result: Record<string, string> = {}

    for (const field of fieldData) {
      const value = field.values?.[0]
      if (!value) continue

      switch (field.name.toLowerCase()) {
        case "email":
          result.email = value
          break
        case "phone_number":
        case "phone":
          result.phone = value
          break
        case "full_name":
          result.full_name = value
          break
        case "first_name":
          result.first_name = value
          break
        case "last_name":
          result.last_name = value
          break
        case "company_name":
        case "company":
          result.company_name = value
          break
        case "job_title":
        case "title":
          result.job_title = value
          break
        case "city":
          result.city = value
          break
        case "state":
        case "province":
          result.state = value
          break
        case "country":
          result.country = value
          break
        case "zip_code":
        case "zip":
        case "postal_code":
          result.zip_code = value
          break
      }
    }

    return result
  }

  /**
   * Extract lead count from insights actions
   */
  extractLeadCount(insights: InsightsData): number {
    let leadCount = 0

    for (const row of insights.data) {
      if (row.actions) {
        for (const action of row.actions) {
          if (action.action_type === "lead" || action.action_type === "leadgen.other") {
            leadCount += parseInt(action.value, 10) || 0
          }
        }
      }
    }

    return leadCount
  }
}
