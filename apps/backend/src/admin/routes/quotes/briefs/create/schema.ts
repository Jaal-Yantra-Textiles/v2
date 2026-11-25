import { z } from "@medusajs/framework/zod"

/**
 * The New brief form (#2608). Mirrors AdminCreateQuoteBriefReq on the server;
 * numbers are kept as strings while typed and converted on submit.
 */
export const ChoiceFormSchema = z.object({
  partner_id: z.string().min(1),
  partner_name: z.string(),
  rate_id: z.string().nullable(),
  sample_ids: z.array(z.string()),
})

export const StepFormSchema = z
  .object({
    key: z.string(),
    /** Empty = no technique: the partners are named directly, with a role. */
    technique: z.string(),
    label: z.string(),
    qty_per_piece: z.string(),
    lead_days: z.string(),
    note: z.string(),
    choices: z.array(ChoiceFormSchema),
  })
  .refine((s) => !!s.technique || !!s.label.trim(), {
    message: "Pick a technique, or give the partners' role",
    path: ["label"],
  })

export const OptionFormSchema = z.object({
  key: z.string(),
  title: z.string().trim().min(1, "Name the style"),
  description: z.string(),
  story: z.string().max(1000),
  steps: z.array(StepFormSchema).min(1),
})

export const BriefFormSchema = z.object({
  partner_id: z.string().min(1, "Pick the lead partner"),
  partner_name: z.string(),
  title: z.string().trim().min(1, "Give the brief a title"),
  intro: z.string(),
  buyer_email: z.union([z.literal(""), z.string().email("Not an email address")]),
  recipient_name: z.string(),
  recipient_company: z.string(),
  region_id: z.string().min(1, "Pick a region"),
  destination_country_code: z.string().length(2, "Pick the buyer's country"),
  sample_quantity: z.string(),
  sample_days: z.string(),
  options: z.array(OptionFormSchema).min(1),
})
export type BriefFormValues = z.infer<typeof BriefFormSchema>
export type StepFormValues = z.infer<typeof StepFormSchema>

/** Fields each step owns, so Continue validates only its own. */
export const BUYER_FIELDS = [
  "partner_id",
  "title",
  "buyer_email",
  "region_id",
  "destination_country_code",
] as const

const k = () => Math.random().toString(36).slice(2)
export const newStep = (): StepFormValues => ({
  key: k(),
  technique: "",
  label: "",
  qty_per_piece: "",
  lead_days: "",
  note: "",
  choices: [],
})
export const newOption = (): BriefFormValues["options"][number] => ({
  key: k(),
  title: "",
  description: "",
  story: "",
  steps: [newStep()],
})

const num = (v: string) => (v.trim() ? Number(v) : null)

/** Form → POST /admin/quote-briefs body. */
export const toCreateBody = (v: BriefFormValues) => ({
  partner_id: v.partner_id,
  title: v.title.trim(),
  intro: v.intro.trim() || null,
  destination_country_code: v.destination_country_code.toLowerCase(),
  sample_quantity: num(v.sample_quantity),
  sample_days: num(v.sample_days),
  buyer_email: v.buyer_email.trim() || null,
  recipient_name: v.recipient_name.trim() || null,
  recipient_company: v.recipient_company.trim() || null,
  options: v.options.map((o) => ({
    title: o.title.trim(),
    description: o.description.trim() || null,
    story: o.story.trim() || null,
    steps: o.steps.map((s) => ({
      label: s.label.trim() || s.technique,
      kind: "process" as const,
      technique: s.technique || null,
      qty_per_piece: num(s.qty_per_piece),
      lead_days: num(s.lead_days),
      note: s.note.trim() || null,
      choices: s.choices.map((c) => ({ partner_id: c.partner_id, rate_id: c.rate_id, sample_ids: c.sample_ids })),
    })),
  })),
})
