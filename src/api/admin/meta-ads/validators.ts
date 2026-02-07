import { z as z } from "zod"

// Lead status enum
export const LeadStatusEnum = z.enum([
  "new",
  "contacted", 
  "qualified",
  "unqualified",
  "converted",
  "lost",
  "archived",
])

// List leads query params
export const ListLeadsQuerySchema = z.object({
  status: LeadStatusEnum.optional(),
  campaign_id: z.string().optional(),
  form_id: z.string().optional(),
  platform_id: z.string().optional(),
  since: z.string().optional(),
  until: z.string().optional(),
  q: z.string().optional(),
  limit: z.coerce.number().optional().default(50),
  offset: z.coerce.number().optional().default(0),
})

// Update lead body
export const UpdateLeadSchema = z.object({
  status: LeadStatusEnum.optional(),
  notes: z.string().optional(),
  assigned_to: z.string().optional(),
  estimated_value: z.number().optional(),
  actual_value: z.number().optional(),
  person_id: z.string().optional(),
})

// Sync leads body
export const SyncLeadsSchema = z.object({
  platform_id: z.string(),
  form_id: z.string().optional(),
  since: z.string().optional(),
})

// Sync ad accounts body
export const SyncAdAccountsSchema = z.object({
  platform_id: z.string(),
})

// List campaigns query params
export const ListCampaignsQuerySchema = z.object({
  ad_account_id: z.string().optional(),
  status: z.string().optional(),
  limit: z.coerce.number().optional().default(50),
  offset: z.coerce.number().optional().default(0),
})

// Sync campaigns body
export const SyncCampaignsSchema = z.object({
  ad_account_id: z.string(),
  include_insights: z.boolean().optional().default(false),
})

// Sync insights body
export const SyncInsightsSchema = z.object({
  platform_id: z.string(),
  ad_account_id: z.string(),
  level: z.enum(["account", "campaign", "adset", "ad"]).optional().default("campaign"),
  date_preset: z.enum(["last_7d", "last_14d", "last_30d", "last_90d", "maximum"]).optional().default("last_30d"),
  time_increment: z.string().optional().default("1"),
  include_breakdowns: z.coerce.boolean().optional().default(false),
})

export const MetaAdsOverviewQuerySchema = z.object({
  platform_id: z.string(),
  ad_account_id: z.string(),
  level: z.enum(["account", "campaign", "adset", "ad"]).optional().default("account"),
  object_id: z.string().optional(),
  date_preset: z.string().optional().default("last_30d"),
  time_increment: z.coerce.number().optional(),
  include_audience: z.coerce.boolean().optional().default(true),
  include_content: z.coerce.boolean().optional().default(true),
  persist: z.coerce.boolean().optional().default(false),
  refresh: z.enum(["auto", "force", "never"]).optional().default("auto"),
  max_age_minutes: z.coerce.number().optional().default(60),
})

export const CreateRemoteAdSchema = z.object({
  platform_id: z.string(),
  ad_account_id: z.string(),
  // Placeholder for future custom ad payload mapping.
  data: z.record(z.string(), z.any()).optional(),
})
