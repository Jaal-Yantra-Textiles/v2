import { z } from "@medusajs/framework/zod"

export const investorSchema = z.object({
  name: z.string(),
  handle: z.string().optional(),
  logo: z.string().optional(),
  email: z.string().email(),
  status: z.enum(["active", "inactive", "pending"]).optional(),
  is_verified: z.boolean().optional(),
  investor_type: z.enum(["individual", "entity", "fund"]).optional(),
  legal_name: z.string().optional(),
  tax_id: z.string().optional(),
  country_code: z.string().min(2).max(2).optional(),
  currency_code: z.string().min(3).max(3).optional(),
  admin: z.object({
    email: z.string().email(),
    first_name: z.string().optional(),
    last_name: z.string().optional(),
    phone: z.string().optional(),
    role: z.enum(["owner", "admin", "viewer"]).optional(),
  }).strict(),
}).strict()

export const investorUpdateSchema = z.object({
  name: z.string().optional(),
  handle: z.string().optional(),
  logo: z.string().nullable().optional(),
  email: z.string().email().nullable().optional(),
  status: z.enum(["active", "inactive", "pending"]).optional(),
  is_verified: z.boolean().optional(),
  investor_type: z.enum(["individual", "entity", "fund"]).optional(),
  legal_name: z.string().nullable().optional(),
  tax_id: z.string().nullable().optional(),
  tax_id_type: z.string().nullable().optional(),
  country_code: z.string().min(2).max(2).nullable().optional(),
  currency_code: z.string().min(3).max(3).nullable().optional(),
  phone: z.string().nullable().optional(),
  wallet_address: z.string().nullable().optional(),
  bank_account_ref: z.string().nullable().optional(),
  metadata: z.record(z.string(), z.any()).nullable().optional(),
})

export const investorAdminSchema = z.object({
  email: z.string().email(),
  first_name: z.string().optional(),
  last_name: z.string().optional(),
  phone: z.string().optional(),
  role: z.enum(["owner", "admin", "viewer"]).optional(),
  temp_password: z.string().optional(),
})

export const capTableSchema = z.object({
  company_id: z.string(),
  name: z.string(),
  status: z.enum(["draft", "active", "archived"]).optional(),
  total_shares_authorized: z.number().nullable().optional(),
  currency_code: z.string().min(3).max(3).optional(),
  metadata: z.record(z.string(), z.any()).nullable().optional(),
})

export const capTableUpdateSchema = z.object({
  name: z.string().optional(),
  status: z.enum(["draft", "active", "archived"]).optional(),
  total_shares_authorized: z.number().nullable().optional(),
  total_shares_issued: z.number().nullable().optional(),
  total_shares_outstanding: z.number().nullable().optional(),
  fully_diluted_shares: z.number().nullable().optional(),
  pre_money_valuation: z.number().nullable().optional(),
  post_money_valuation: z.number().nullable().optional(),
  currency_code: z.string().min(3).max(3).nullable().optional(),
  metadata: z.record(z.string(), z.any()).nullable().optional(),
})

export const shareClassSchema = z.object({
  cap_table_id: z.string().optional(),
  name: z.string(),
  class_type: z.enum([
    "common", "preferred", "convertible_note", "safe", "warrant", "option",
  ]).optional(),
  authorized_shares: z.number().nullable().optional(),
  issued_shares: z.number().nullable().optional(),
  par_value: z.number().nullable().optional(),
  liquidation_preference: z.number().nullable().optional(),
  liquidation_preference_type: z.enum([
    "none", "non_participating", "participating",
  ]).optional(),
  dividend_rate: z.number().nullable().optional(),
  conversion_ratio: z.number().nullable().optional(),
  voting_rights: z.enum(["full", "limited", "none"]).optional(),
  is_convertible: z.boolean().optional(),
  notes: z.string().nullable().optional(),
})

export const stakeSchema = z.object({
  investor_id: z.string().optional(),
  cap_table_id: z.string().optional(),
  share_class_id: z.string().optional(),
  funding_round_id: z.string().optional(),
  number_of_shares: z.number(),
  share_price: z.number().nullable().optional(),
  total_invested: z.number().nullable().optional(),
  ownership_percentage: z.number().nullable().optional(),
  certificate_number: z.string().optional(),
  issue_date: z.string().datetime().optional(),
  status: z.enum([
    "active", "fully_paid", "partially_paid", "unpaid", "cancelled",
  ]).optional(),
})

export const fundingRoundSchema = z.object({
  cap_table_id: z.string().optional(),
  name: z.string(),
  round_type: z.enum([
    "pre_seed", "seed", "series_a", "series_b", "series_c",
    "series_d_plus", "bridge", "debt", "grant",
  ]).optional(),
  status: z.enum([
    "planned", "open", "closing", "closed", "cancelled",
  ]).optional(),
  target_amount: z.number().nullable().optional(),
  raised_amount: z.number().nullable().optional(),
  pre_money_valuation: z.number().nullable().optional(),
  post_money_valuation: z.number().nullable().optional(),
  price_per_share: z.number().nullable().optional(),
  shares_offered: z.number().nullable().optional(),
  open_date: z.string().datetime().nullable().optional(),
  close_date: z.string().datetime().nullable().optional(),
  lead_investor: z.string().nullable().optional(),
})

export const pipelineSchema = z.object({
  company_id: z.string(),
  stage: z.enum([
    "lead", "contacted", "interested", "due_diligence",
    "term_sheet", "committed", "onboarded", "closed", "passed",
  ]).optional(),
  status: z.enum(["active", "won", "lost", "on_hold"]).optional(),
  target_amount: z.number().nullable().optional(),
  committed_amount: z.number().nullable().optional(),
  source: z.string().nullable().optional(),
  assigned_to: z.string().nullable().optional(),
  next_action: z.string().nullable().optional(),
  next_action_date: z.string().datetime().nullable().optional(),
  notes: z.string().nullable().optional(),
})

export const callForSharesSchema = z.object({
  cap_table_id: z.string().optional(),
  name: z.string(),
  call_type: z.enum([
    "rights_issue", "follow_on", "capital_call", "top_up",
  ]).optional(),
  status: z.enum([
    "draft", "announced", "open", "closing", "closed", "cancelled",
  ]).optional(),
  shares_offered: z.number().nullable().optional(),
  price_per_share: z.number().nullable().optional(),
  target_amount: z.number().nullable().optional(),
  open_date: z.string().datetime().nullable().optional(),
  close_date: z.string().datetime().nullable().optional(),
  record_date: z.string().datetime().nullable().optional(),
  ratio: z.string().nullable().optional(),
  terms: z.string().nullable().optional(),
})

export const paymentSchema = z.object({
  stake_id: z.string().optional(),
  call_for_shares_id: z.string().optional(),
  investor_id: z.string().optional(),
  company_id: z.string(),
  amount: z.number(),
  currency_code: z.string().min(3).max(3).optional(),
  payment_type: z.enum([
    "subscription", "capital_call", "top_up", "transfer_fee", "other",
  ]).optional(),
  status: z.enum([
    "pending", "in_progress", "completed", "failed", "refunded", "cancelled",
  ]).optional(),
  method: z.enum([
    "bank_transfer", "card", "upi", "wallet", "cheque", "other",
  ]).nullable().optional(),
  reference_number: z.string().nullable().optional(),
  due_date: z.string().datetime().nullable().optional(),
  paid_date: z.string().datetime().nullable().optional(),
  notes: z.string().nullable().optional(),
})

export const documentSchema = z.object({
  company_id: z.string(),
  cap_table_id: z.string().optional(),
  call_for_shares_id: z.string().optional(),
  investor_id: z.string().nullable().optional(),
  title: z.string(),
  description: z.string().nullable().optional(),
  document_type: z.enum([
    "share_certificate", "subscription_agreement", "term_sheet",
    "sha", "financial_statement", "pitch_deck", "kyc", "legal", "other",
  ]).optional(),
  file_key: z.string(),
  file_url: z.string().nullable().optional(),
  file_name: z.string().nullable().optional(),
  file_size: z.number().nullable().optional(),
  mime_type: z.string().nullable().optional(),
  visibility: z.enum(["private", "investor", "public"]).optional(),
})

export const companySchema = z.object({
  name: z.string(),
  legal_name: z.string(),
  email: z.string().email(),
  phone: z.string(),
  address: z.string(),
  city: z.string(),
  state: z.string(),
  country: z.string(),
  postal_code: z.string(),
  website: z.string().nullable().optional(),
  logo_url: z.string().nullable().optional(),
  registration_number: z.string().nullable().optional(),
  tax_id: z.string().nullable().optional(),
  founded_date: z.string().datetime().nullable().optional(),
  industry: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  investor_dashboard_enabled: z.boolean().optional(),
})

export const companyUpdateSchema = z.object({
  name: z.string().optional(),
  legal_name: z.string().optional(),
  email: z.string().email().nullable().optional(),
  phone: z.string().nullable().optional(),
  address: z.string().nullable().optional(),
  city: z.string().nullable().optional(),
  state: z.string().nullable().optional(),
  country: z.string().nullable().optional(),
  postal_code: z.string().nullable().optional(),
  website: z.string().nullable().optional(),
  logo_url: z.string().nullable().optional(),
  registration_number: z.string().nullable().optional(),
  tax_id: z.string().nullable().optional(),
  founded_date: z.string().datetime().nullable().optional(),
  industry: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  investor_dashboard_enabled: z.boolean().nullable().optional(),
  status: z.enum(["Active", "Inactive", "Pending", "Suspended"]).optional(),
  cap_table_id: z.string().nullable().optional(),
})
