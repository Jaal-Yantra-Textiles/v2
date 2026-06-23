import type { MaintenanceChange } from "../../api/admin/ops/maintenance-jobs/registry"
import {
  diffOutreachEngagement,
  type OutreachEngagementPatch,
  type OutreachEngagementRow,
  type OutreachProviderEvent,
  type OutreachStatus,
} from "./diff-outreach-engagement"

/**
 * Batch engagement reconciliation for `marketing_outreach` (#659 slice 4 / PR-4d).
 *
 * `diffOutreachEngagement` (PR-4b) reconciles ONE row against ONE provider event.
 * This pure layer fans that out across a batch: it matches a set of normalized
 * provider events to the persisted rows (by row id, falling back to the provider
 * `external_id`), folds multiple events for the same row forward-only, and returns
 * the minimal per-row patches + a flat change set for the dry-run/apply contract.
 *
 * Kept dependency-free so BOTH consumers stay verifiable without booting the DB,
 * the workflow engine, or a live email provider:
 *   - the `POST /admin/marketing/outreach/sync` route (events posted in the body,
 *     e.g. from a Resend webhook relay), and
 *   - the `sync-marketing-outreach-engagement` maintenance job (events pulled from
 *     an optional provider client).
 */

/** A normalized provider event addressed to a specific outreach row. */
export type OutreachSyncEvent = OutreachProviderEvent & {
  /** Target the row directly by its `marketing_outreach` id … */
  id?: string | null
  /** … or by the provider message id persisted on the row. */
  external_id?: string | null
}

/** The row columns this reconciliation reads (superset of the engagement row). */
export type OutreachSyncRow = OutreachEngagementRow & {
  external_id?: string | null
}

/** A single row that changed, with its cumulative patch + per-row change set. */
export type OutreachReconcileItem = {
  id: string
  patch: OutreachEngagementPatch
  changes: MaintenanceChange[]
  nextStatus: OutreachStatus
}

export type OutreachReconcileResult = {
  /** Rows that actually changed (empty patch rows are omitted). */
  items: OutreachReconcileItem[]
  /** Flat change set across every changed row (dry-run/apply payload). */
  changes: MaintenanceChange[]
  /** Distinct row ids an event matched (whether or not they changed). */
  matchedRowIds: string[]
  /** Events that matched no row (unknown id/external_id). */
  unmatchedEvents: number
}

/** Status from which nothing can advance — a definitive reply. */
function isTerminal(status: OutreachStatus | null | undefined): boolean {
  return status === "replied"
}

/**
 * Build the id → row + external_id → row lookup. Row id takes precedence; a blank
 * external_id is never indexed (so it can't accidentally match a null event key).
 */
function indexRows(rows: OutreachSyncRow[]): {
  byId: Map<string, OutreachSyncRow>
  byExternalId: Map<string, OutreachSyncRow>
} {
  const byId = new Map<string, OutreachSyncRow>()
  const byExternalId = new Map<string, OutreachSyncRow>()
  for (const row of rows) {
    if (row?.id) byId.set(row.id, row)
    const ext = typeof row?.external_id === "string" ? row.external_id.trim() : ""
    if (ext) byExternalId.set(ext, row)
  }
  return { byId, byExternalId }
}

function resolveTarget(
  event: OutreachSyncEvent,
  idx: ReturnType<typeof indexRows>
): OutreachSyncRow | null {
  const id = typeof event.id === "string" ? event.id.trim() : ""
  if (id && idx.byId.has(id)) return idx.byId.get(id)!
  const ext =
    typeof event.external_id === "string" ? event.external_id.trim() : ""
  if (ext && idx.byExternalId.has(ext)) return idx.byExternalId.get(ext)!
  return null
}

/** Merge an engagement patch into a working row so later events fold forward. */
function applyPatchToWorking(
  working: OutreachSyncRow,
  patch: OutreachEngagementPatch
): OutreachSyncRow {
  return {
    ...working,
    ...(patch.status !== undefined ? { status: patch.status } : {}),
    ...(patch.sent_at !== undefined ? { sent_at: patch.sent_at } : {}),
    ...(patch.opened_at !== undefined ? { opened_at: patch.opened_at } : {}),
    ...(patch.replied_at !== undefined ? { replied_at: patch.replied_at } : {}),
    ...(patch.bounce_unreliable !== undefined
      ? { bounce_unreliable: patch.bounce_unreliable }
      : {}),
  }
}

/**
 * Reconcile a batch of provider events against the given rows.
 *
 * - Events addressing the same row are folded forward-only (a second event can
 *   only advance the row further, never downgrade it — `diffOutreachEngagement`
 *   guarantees monotonicity).
 * - Events that match no row are counted (`unmatchedEvents`) but never error.
 * - Re-running with the same events after an apply yields zero changes
 *   (idempotent), because the persisted timestamps/status already satisfy them.
 *
 * Never throws — bad dates are treated as "no signal" by the underlying diff.
 */
export function reconcileOutreachBatch(
  rows: OutreachSyncRow[],
  events: OutreachSyncEvent[]
): OutreachReconcileResult {
  const idx = indexRows(rows ?? [])
  // Working copies so multiple events per row accumulate.
  const working = new Map<string, OutreachSyncRow>()
  // Accumulated patch + changes per row id.
  const accPatch = new Map<string, OutreachEngagementPatch>()
  const accChanges = new Map<string, MaintenanceChange[]>()
  const accNext = new Map<string, OutreachStatus>()
  const matched = new Set<string>()
  let unmatchedEvents = 0

  for (const event of events ?? []) {
    const target = resolveTarget(event, idx)
    if (!target) {
      unmatchedEvents++
      continue
    }
    const id = target.id
    matched.add(id)
    const current = working.get(id) ?? target
    const diff = diffOutreachEngagement(current, event)
    accNext.set(id, diff.nextStatus)
    if (diff.changes.length === 0) {
      if (!working.has(id)) working.set(id, current)
      continue
    }
    working.set(id, applyPatchToWorking(current, diff.patch))
    accPatch.set(id, { ...(accPatch.get(id) ?? {}), ...diff.patch })
    accChanges.set(id, [...(accChanges.get(id) ?? []), ...diff.changes])
  }

  const items: OutreachReconcileItem[] = []
  const changes: MaintenanceChange[] = []
  for (const [id, patch] of accPatch) {
    const rowChanges = accChanges.get(id) ?? []
    if (rowChanges.length === 0) continue
    items.push({
      id,
      patch,
      changes: rowChanges,
      nextStatus: accNext.get(id) ?? "queued",
    })
    changes.push(...rowChanges)
  }

  return {
    items,
    changes,
    matchedRowIds: Array.from(matched),
    unmatchedEvents,
  }
}

/**
 * Select the rows worth syncing: a stable provider message id (`external_id`) to
 * look up, and not already in the terminal `replied` state (nothing can advance
 * a reply). Pure so the maintenance job's candidate scan stays testable.
 */
export function selectSyncableOutreach(
  rows: OutreachSyncRow[]
): OutreachSyncRow[] {
  return (rows ?? []).filter((row) => {
    const ext =
      typeof row?.external_id === "string" ? row.external_id.trim() : ""
    return !!ext && !isTerminal(row?.status ?? "queued")
  })
}

/** Human-facing one-liner for the dry-run/apply result + ops audit log. */
export function summarizeOutreachSync(opts: {
  dry_run: boolean
  eventsReceived: number
  matchedRows: number
  changedRows: number
  totalChanges: number
  providerConfigured?: boolean
}): string {
  const {
    dry_run,
    eventsReceived,
    matchedRows,
    changedRows,
    totalChanges,
    providerConfigured,
  } = opts

  if (providerConfigured === false) {
    return "Marketing outreach sync provider not configured — nothing to reconcile."
  }

  if (changedRows === 0) {
    return `No engagement changes from ${eventsReceived} event(s) (${matchedRows} row(s) matched, already up to date).`
  }

  const verb = dry_run ? "Would update" : "Updated"
  return `${verb} ${changedRows} outreach row(s) — ${totalChanges} field change(s) from ${eventsReceived} event(s) (${matchedRows} matched).`
}
