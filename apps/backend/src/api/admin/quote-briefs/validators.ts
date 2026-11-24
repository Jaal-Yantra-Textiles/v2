import { z } from "@medusajs/framework/zod"

import { TECHNIQUE_SLUGS } from "../../../modules/partner_capability/lib/techniques"

const ChoiceSchema = z.object({
  partner_id: z.string().min(1),
  /** A partner_capability_rate id; omit for "we'll confirm". */
  rate_id: z.string().min(1).optional().nullable(),
  sample_ids: z.array(z.string().min(1)).optional(),
  note: z.string().optional().nullable(),
})

const StepSchema = z.object({
  label: z.string().min(1),
  kind: z.enum(["fabric", "process"]).optional(),
  technique: z.enum(TECHNIQUE_SLUGS).optional().nullable(),
  qty_per_piece: z.number().positive().optional().nullable(),
  note: z.string().optional().nullable(),
  /** Days for this step on the order, when the rate doesn't say. */
  lead_days: z.number().int().positive().max(365).optional().nullable(),
  /** Empty = "we're exploring partners for this". */
  choices: z.array(ChoiceSchema).default([]),
})

const OptionSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional().nullable(),
  /** What the buyer can tell HER customers. True statements only. */
  story: z.string().max(1000).optional().nullable(),
  steps: z.array(StepSchema).min(1),
})

export const BRIEF_QUESTION_KINDS = [
  "text",
  "long_text",
  "number",
  "choice",
  "multi_choice",
  "date",
  "boolean",
  "link",
  "file",
] as const

const QuestionSchema = z.object({
  key: z.string().min(1).regex(/^[a-z0-9_]+$/, "lower_snake_case"),
  label: z.string().min(1),
  help: z.string().optional().nullable(),
  kind: z.enum(BRIEF_QUESTION_KINDS),
  options: z.array(z.string().min(1)).optional().nullable(),
  required: z.boolean().optional(),
})

export const AdminCreateQuoteBriefReq = z.object({
  partner_id: z.string().min(1),
  title: z.string().min(1),
  intro: z.string().optional().nullable(),
  destination_country_code: z.string().length(2),
  currency_code: z.string().length(3).optional(),
  sample_quantity: z.number().int().positive().optional().nullable(),
  sample_days: z.number().int().positive().max(365).optional().nullable(),
  customer_id: z.string().optional().nullable(),
  buyer_email: z.string().email().optional().nullable(),
  recipient_name: z.string().optional().nullable(),
  recipient_company: z.string().optional().nullable(),
  options: z.array(OptionSchema).min(1),
  /** Omit to use the default made-to-order questions. */
  questions: z.array(QuestionSchema).optional(),
})
export type AdminCreateQuoteBriefReqType = z.infer<typeof AdminCreateQuoteBriefReq>

export const AdminUpdateQuoteBriefReq = z.object({
  title: z.string().min(1).optional(),
  intro: z.string().optional().nullable(),
  sample_quantity: z.number().int().positive().optional().nullable(),
  sample_days: z.number().int().positive().max(365).optional().nullable(),
  status: z.enum(["draft", "open", "submitted", "sampling", "quoted", "closed"]).optional(),
  quote_id: z.string().optional().nullable(),
})

export const AdminOpenQuoteBriefReq = z.object({
  ttl_days: z.number().int().positive().max(365).optional(),
})

export const AdminPostQuoteBriefUpdateReq = z.object({
  kind: z.enum(["note", "sample", "price"]).optional(),
  message: z.string().min(1),
  media_urls: z.array(z.string().url()).optional(),
})

/** One artwork file, base64, from the brief page (via the storefront server). */
export const StoreBriefFileReq = z.object({
  question_key: z.string().min(1),
  name: z.string().min(1).max(200),
  type: z.string().min(1),
  /** base64, no data: prefix. */
  content_base64: z.string().min(1),
})

/** What the buyer sends from the brief page. */
export const StoreSubmitQuoteBriefReq = z.object({
  /** question key → answer. Validated per question kind. */
  answers: z.record(z.string(), z.unknown()).optional(),
  /** option ids she is interested in (replaces the previous set). */
  selected_option_ids: z.array(z.string()).optional(),
  /** step id → choice id (her pick of partner for that step). */
  step_choices: z.record(z.string(), z.string().nullable()).optional(),
  /** true = "Send my brief"; false/omitted = save progress. */
  submit: z.boolean().optional(),
})
export type StoreSubmitQuoteBriefReqType = z.infer<typeof StoreSubmitQuoteBriefReq>
