import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"

import { MARKETING_MODULE } from "../../modules/marketing"

/**
 * logOutreachWorkflow (#659 slice 4 / PR-4c).
 *
 * Persists a single hand-crafted outbound row into `marketing_outreach`
 * (Winbacks / Exec outreach CRM). Mirrors the create-record workflow pattern
 * used elsewhere (designs, inbound-emails): one step + a compensation that
 * deletes the row if anything downstream fails.
 *
 * Normalisation happens HERE (not in the route) so every caller — route,
 * future cron, provider-sync job — produces consistent rows:
 *   - `recipient_email` is lower-cased + trimmed (matches the engagement-sync
 *     lookup in `diff-outreach-engagement.ts`, which keys on the message id but
 *     emails must still dedupe predictably).
 *   - blank optional strings collapse to `null` so list filters stay clean.
 */

export type LogOutreachInput = {
  recipient_email: string
  recipient_name?: string | null
  company?: string | null
  campaign?: string | null
  channel?: "email" | "whatsapp" | "manual"
  status?: "queued" | "sent" | "opened" | "replied" | "bounced" | "unknown"
  notes?: string | null
  external_id?: string | null
  sent_at?: Date | string | null
}

function blankToNull(v: string | null | undefined): string | null {
  if (typeof v !== "string") {
    return null
  }
  const trimmed = v.trim()
  return trimmed.length > 0 ? trimmed : null
}

const logOutreachStep = createStep(
  "log-outreach",
  async (input: LogOutreachInput, { container }) => {
    const service = container.resolve(MARKETING_MODULE) as any

    const payload = {
      recipient_email: input.recipient_email.trim().toLowerCase(),
      recipient_name: blankToNull(input.recipient_name),
      company: blankToNull(input.company),
      campaign: blankToNull(input.campaign),
      channel: input.channel ?? "email",
      status: input.status ?? "queued",
      notes: blankToNull(input.notes),
      external_id: blankToNull(input.external_id),
      sent_at: input.sent_at ?? null,
    }

    const created = await service.createMarketingOutreaches(payload)

    return new StepResponse(created, created?.id)
  },
  async (id, { container }) => {
    if (!id) {
      return
    }
    const service = container.resolve(MARKETING_MODULE) as any
    await service.deleteMarketingOutreaches(id)
  }
)

export const logOutreachWorkflow = createWorkflow(
  "log-outreach",
  (input: LogOutreachInput) => {
    const outreach = logOutreachStep(input)
    return new WorkflowResponse(outreach)
  }
)

export default logOutreachWorkflow
