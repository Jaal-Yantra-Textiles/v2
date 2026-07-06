import { MARKETING_MODULE } from "./index"
import {
  reconcileOutreachBatch,
  type OutreachSyncEvent,
  type OutreachSyncRow,
} from "./outreach-sync-lib"
import type { EngagementType } from "../email_engagement/provider-parsers"

/**
 * Bridge (Option C) — feed live ESP delivery/open/click events from the
 * `email_engagement` webhooks into the marketing `marketing_outreach`
 * reconciliation layer, which was BUILT but STARVED (no relay/adapter wired).
 *
 * Matches an outreach row by `external_id` = the provider message id. A no-op
 * when the message isn't a marketing campaign send (the vast majority of
 * newsletter/blog opens), so it's safe to call on every engagement event. The
 * reconciliation is forward-only + idempotent (`diffOutreachEngagement`), so a
 * re-delivered webhook can't downgrade or double-write a row.
 *
 * Signal mapping (our types → outreach state machine):
 *   delivered → sent_at    (outreach "sent" = reached the recipient)
 *   open      → opened_at
 *   click     → opened_at   (outreach has no `clicked` state; a click implies open)
 */

export type EngagementToOutreachInput = {
  type: EngagementType
  message_id: string | null | undefined
  /** Resolved ISO instant (caller defaults null → now). */
  at: string
}

export type BridgeOutcome = { matched: number; changed: number }

/**
 * PURE: map one engagement event to a normalized outreach sync event, or null
 * when it can't address a row (no message id) or carries no usable signal.
 */
export function engagementToOutreachEvent(
  input: EngagementToOutreachInput
): OutreachSyncEvent | null {
  const message_id =
    typeof input.message_id === "string" ? input.message_id.trim() : ""
  if (!message_id || !input.at) return null

  const event: OutreachSyncEvent = { external_id: message_id }
  if (input.type === "delivered") event.sent_at = input.at
  else if (input.type === "open" || input.type === "click")
    event.opened_at = input.at
  else return null
  return event
}

/**
 * Reconcile one engagement event onto any matching `marketing_outreach` row.
 * Container-driven; best-effort by design — the caller's own ledger write is the
 * source of truth, this is the secondary feed.
 */
export async function bridgeOutreachEngagement(
  container: any,
  input: { type: EngagementType; message_id: string | null | undefined; event_at: string | null }
): Promise<BridgeOutcome> {
  const at = input.event_at || new Date().toISOString()
  const event = engagementToOutreachEvent({
    type: input.type,
    message_id: input.message_id,
    at,
  })
  if (!event) return { matched: 0, changed: 0 }

  const service: any = container.resolve(MARKETING_MODULE)
  const rows: OutreachSyncRow[] = await service
    .listMarketingOutreaches({ external_id: [event.external_id] })
    .catch(() => [])
  if (!rows?.length) return { matched: 0, changed: 0 }

  const result = reconcileOutreachBatch(rows, [event])
  for (const item of result.items) {
    await service.updateMarketingOutreaches({ id: item.id, ...item.patch })
  }
  return { matched: result.matchedRowIds.length, changed: result.items.length }
}
