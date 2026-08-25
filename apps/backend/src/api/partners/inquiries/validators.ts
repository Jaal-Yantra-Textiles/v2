import { z } from "zod"

/**
 * #1531 slice 2 — the partner's half of a design inquiry.
 *
 * 🔴 `partner_id` appears in NONE of these schemas, deliberately. It is taken
 * from the auth context and never from the body. A partner who could name the
 * partner they are answering as could answer as a competitor — and validation
 * that accepted the field would make that a one-line route bug rather than an
 * impossible one.
 */

/**
 * One answer. `value` is untyped on purpose: the shape follows the question's
 * `kind` — a bool for `yes_no`, a number for `number`, a list of colour values
 * for `colour_select`. Pinning it per kind here would put the question
 * vocabulary in two places, and they would drift.
 *
 * `note` is separate from `value` and matters more than it looks: the useful
 * part of "no" is almost always the sentence after it.
 */
const PartnerInquiryAnswer = z.object({
  question_id: z.string().min(1),
  value: z.unknown().optional(),
  note: z.string().optional().nullable(),
  /** partner_capability_sample ids — the photographs evidencing this answer. */
  capability_sample_ids: z.array(z.string().min(1)).optional(),
})

/**
 * Answers are saved in batches so the wizard can autosave a whole step, and
 * `min(1)` because an empty write is a no-op the caller should not be told
 * succeeded.
 */
export const PartnerPostInquiryAnswersReq = z.object({
  answers: z.array(PartnerInquiryAnswer).min(1),
})
export type PartnerPostInquiryAnswersReq = z.infer<
  typeof PartnerPostInquiryAnswersReq
>

/**
 * Submitting. Every field optional EXCEPT the verdict — the verdict is the one
 * thing the whole inquiry is asking for, and a submission without it is
 * indistinguishable from the silence of a partner who never replied.
 *
 * 🔑 `with_changes` is the answer that matters most and the one a yes/no would
 * have thrown away: "not in that GSM, but I can do 90" is how a design
 * actually develops.
 */
export const PartnerPostInquirySubmitReq = z.object({
  verdict: z.enum(["can_make", "cannot_make", "with_changes"]),
  lead_time_days: z.number().int().positive().optional().nullable(),
  indicative_price: z.number().nonnegative().optional().nullable(),
  currency_code: z.string().min(3).max(3).optional().nullable(),
  notes: z.string().optional().nullable(),
  /** A last batch of answers, so "save and submit" is one round trip. */
  answers: z.array(PartnerInquiryAnswer).optional(),
})
export type PartnerPostInquirySubmitReq = z.infer<
  typeof PartnerPostInquirySubmitReq
>

export const PartnerListInquiriesQuery = z.object({
  status: z.enum(["open", "closed"]).optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
  offset: z.coerce.number().int().nonnegative().optional(),
})
export type PartnerListInquiriesQuery = z.infer<
  typeof PartnerListInquiriesQuery
>

/**
 * A capability sample — a photograph of something the partner has actually
 * made, with the textile facts beside it.
 *
 * `captured_at` is optional but NOT defaulted to now in the schema: the route
 * defaults it and says it did. A photo typed up three weeks after it was taken
 * describes a capability that may already be gone, and the library is only
 * trustworthy if it says how stale it is.
 */
export const PartnerPostCapabilitySampleReq = z.object({
  title: z.string().min(1),
  technique: z.string().optional().nullable(),
  material: z.string().optional().nullable(),
  media_file_ids: z.array(z.string().min(1)).optional(),
  notes: z.string().optional().nullable(),
  captured_at: z.coerce.date().optional().nullable(),
})
export type PartnerPostCapabilitySampleReq = z.infer<
  typeof PartnerPostCapabilitySampleReq
>

export const PartnerListCapabilitySamplesQuery = z.object({
  q: z.string().optional(),
  technique: z.string().optional(),
  material: z.string().optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
  offset: z.coerce.number().int().nonnegative().optional(),
})
export type PartnerListCapabilitySamplesQuery = z.infer<
  typeof PartnerListCapabilitySamplesQuery
>
