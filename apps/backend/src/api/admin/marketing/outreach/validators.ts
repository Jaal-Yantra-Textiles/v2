import { z } from "@medusajs/framework/zod"

/**
 * Validators for the marketing-outreach CRM routes (#659 slice 4 / PR-4c).
 *
 * These routes do NOT use `validateAndTransformBody`/`validateAndTransformQuery`
 * middleware — the marketing read routes (PR-3c) parse manually to keep the
 * `/admin/marketing` matcher off the shared `middlewares.ts` list (avoids the
 * cross-PR matcher reconciliation churn). We mirror that here and parse with
 * these schemas inside the handlers, so undeclared query params are simply
 * ignored rather than producing a 400 (#508 watch-out).
 */

export const OUTREACH_STATUSES = [
  "queued",
  "sent",
  "opened",
  "replied",
  "bounced",
  "unknown",
] as const

export const OUTREACH_CHANNELS = ["email", "whatsapp", "manual"] as const

// ── List query ───────────────────────────────────────────────────────────────
export const listOutreachQuerySchema = z.object({
  q: z.string().optional(),
  status: z.enum(OUTREACH_STATUSES).optional(),
  channel: z.enum(OUTREACH_CHANNELS).optional(),
  campaign: z.string().optional(),
  offset: z.preprocess(
    (val) =>
      val !== undefined && val !== null && val !== "" ? Number(val) : undefined,
    z.number().int().min(0).default(0)
  ),
  limit: z.preprocess(
    (val) =>
      val !== undefined && val !== null && val !== "" ? Number(val) : undefined,
    z.number().int().min(1).max(200).default(50)
  ),
})

export type ListOutreachQuery = z.infer<typeof listOutreachQuerySchema>

// ── Create body ──────────────────────────────────────────────────────────────
export const createOutreachBodySchema = z.object({
  recipient_email: z.string().min(1, "recipient_email is required"),
  recipient_name: z.string().optional().nullable(),
  company: z.string().optional().nullable(),
  campaign: z.string().optional().nullable(),
  channel: z.enum(OUTREACH_CHANNELS).optional(),
  status: z.enum(OUTREACH_STATUSES).optional(),
  notes: z.string().optional().nullable(),
  external_id: z.string().optional().nullable(),
})

export type CreateOutreachBody = z.infer<typeof createOutreachBodySchema>

// ── Update body ──────────────────────────────────────────────────────────────
// Free-form CRM edits. Status transitions made via the UI are operator intent,
// so unlike the engagement-sync state machine this allows any status value.
export const updateOutreachBodySchema = z
  .object({
    recipient_name: z.string().optional().nullable(),
    company: z.string().optional().nullable(),
    campaign: z.string().optional().nullable(),
    channel: z.enum(OUTREACH_CHANNELS).optional(),
    status: z.enum(OUTREACH_STATUSES).optional(),
    notes: z.string().optional().nullable(),
    bounce_unreliable: z.boolean().optional(),
  })
  .strict()

export type UpdateOutreachBody = z.infer<typeof updateOutreachBodySchema>
