import type { MaintenanceChange } from "../../api/admin/ops/maintenance-jobs/registry"

/**
 * Pure engagement reconciliation for `marketing_outreach` (#659 slice 4 / PR-4b).
 *
 * Given a persisted outreach row and a normalized provider message-event, compute
 * the minimal forward-only change set + the patch to persist. Kept dependency-free
 * so the dry-run/apply maintenance job (PR-4d) and the sync workflow are verifiable
 * without booting the DB, the workflow engine, or a live email provider.
 *
 * Honesty rule (spec §3 + the model's `bounce_unreliable` flag): a provider bounce
 * signal is best-effort. We stamp `status="bounced"` + flag `bounce_unreliable=true`
 * so the operator can act — we NEVER auto-suppress the recipient here.
 *
 * Field names mirror the SHIPPED model
 * (`src/modules/marketing/models/marketing-outreach.ts`), NOT the slice-4 draft spec:
 *   status: queued | sent | opened | replied | bounced | unknown
 *   timestamps: sent_at / opened_at / replied_at
 *   bounce_unreliable: boolean
 */

export type OutreachStatus =
  | "queued"
  | "sent"
  | "opened"
  | "replied"
  | "bounced"
  | "unknown"

/** Subset of `marketing_outreach` columns this reconciliation reads. */
export type OutreachEngagementRow = {
  id: string
  status?: OutreachStatus | null
  sent_at?: Date | string | null
  opened_at?: Date | string | null
  replied_at?: Date | string | null
  bounce_unreliable?: boolean | null
}

/**
 * Normalized provider event (e.g. mapped from a Resend message-events lookup).
 * Every field optional — the provider only reports the signals it has. Dates are
 * accepted as Date or ISO string; absent/null = "no signal".
 */
export type OutreachProviderEvent = {
  sent_at?: Date | string | null
  opened_at?: Date | string | null
  replied_at?: Date | string | null
  bounced_at?: Date | string | null
}

/** Fields the caller persists when applying. Only present when something changed. */
export type OutreachEngagementPatch = {
  status?: OutreachStatus
  sent_at?: Date
  opened_at?: Date
  replied_at?: Date
  bounce_unreliable?: boolean
}

export type OutreachEngagementDiff = {
  changes: MaintenanceChange[]
  patch: OutreachEngagementPatch
  /** The resolved status (== row.status when no advance happened). */
  nextStatus: OutreachStatus
}

const ENTITY = "marketing_outreach"

/**
 * Monotonic status ranking. We only ever advance a row forward, never downgrade —
 * a later partial/empty sync must not clobber a strong signal already recorded.
 * A `replied` outranks `bounced`: a genuine reply is definitive engagement and
 * trumps a (best-effort, unreliable) bounce signal.
 */
const STATUS_RANK: Record<OutreachStatus, number> = {
  queued: 0,
  unknown: 0,
  sent: 1,
  opened: 2,
  bounced: 3,
  replied: 4,
}

function toDate(v: Date | string | null | undefined): Date | null {
  if (v == null) {
    return null
  }
  const d = v instanceof Date ? v : new Date(v)
  return Number.isNaN(d.getTime()) ? null : d
}

/**
 * Reconcile a single outreach row against a provider event.
 *
 * Behaviour:
 *  - fills engagement timestamps that are currently null (never overwrites an
 *    existing stamp — idempotent: re-diffing after apply yields zero changes);
 *  - advances `status` forward only, by the strongest signal present in the event;
 *  - on a bounce signal sets `bounce_unreliable=true` (flag, never suppress).
 *
 * Never throws — bad/NaN dates are treated as "no signal".
 */
export function diffOutreachEngagement(
  row: OutreachEngagementRow,
  event: OutreachProviderEvent
): OutreachEngagementDiff {
  const changes: MaintenanceChange[] = []
  const patch: OutreachEngagementPatch = {}

  const currentStatus: OutreachStatus = (row.status as OutreachStatus) ?? "queued"

  // 1. Fill engagement timestamps (only when currently empty).
  const stampFields: Array<["sent_at" | "opened_at" | "replied_at"]> = [
    ["sent_at"],
    ["opened_at"],
    ["replied_at"],
  ]
  for (const [field] of stampFields) {
    const existing = toDate(row[field])
    const incoming = toDate(event[field])
    if (existing == null && incoming != null) {
      patch[field] = incoming
      changes.push({
        entity: ENTITY,
        id: row.id,
        field,
        before: null,
        after: incoming,
      })
    }
  }

  // 2. Derive the status implied by the event's signals.
  const replied = toDate(event.replied_at) != null
  const bounced = toDate(event.bounced_at) != null
  const opened = toDate(event.opened_at) != null
  const sent = toDate(event.sent_at) != null

  let eventStatus: OutreachStatus | null = null
  if (replied) {
    eventStatus = "replied"
  } else if (bounced) {
    eventStatus = "bounced"
  } else if (opened) {
    eventStatus = "opened"
  } else if (sent) {
    eventStatus = "sent"
  }

  // 3. Advance status forward only.
  let nextStatus = currentStatus
  if (eventStatus != null && STATUS_RANK[eventStatus] > STATUS_RANK[currentStatus]) {
    nextStatus = eventStatus
    patch.status = nextStatus
    changes.push({
      entity: ENTITY,
      id: row.id,
      field: "status",
      before: currentStatus,
      after: nextStatus,
    })
  }

  // 4. Bounce honesty flag — set whenever the event reports a bounce and the row
  //    isn't already flagged. Independent of whether `status` ended up `bounced`
  //    (a reply can outrank the bounce for status, but we still flag the signal).
  if (bounced && row.bounce_unreliable !== true) {
    patch.bounce_unreliable = true
    changes.push({
      entity: ENTITY,
      id: row.id,
      field: "bounce_unreliable",
      before: row.bounce_unreliable ?? false,
      after: true,
    })
  }

  return { changes, patch, nextStatus }
}
