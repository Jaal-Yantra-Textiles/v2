import type ProductionRunService from "../../modules/production_runs/service"

/**
 * The reminder state a decision is made against, for ONE rule.
 *
 * Shaped to stay assignable to what `decideReminderAction` and
 * `decideParkedEscalation` already accept, so the pure deciders did not have to
 * change when the storage did.
 */
export type ReminderState = {
  reminder_kind: string | null
  reminder_count: number
  reminder_status: string | null
  last_reminded_at: Date | string | null
  /** True when this came from the run's legacy columns, not a per-rule row. */
  from_legacy: boolean
}

/**
 * PURE: what is this rule's state right now? Exported for unit testing.
 *
 * #2122 — the per-rule row is the answer whenever one exists. It is authored by
 * this workflow and nothing else writes it, so it is never ambiguous.
 *
 * 🔴 When no row exists yet, the run's legacy columns are read as a FALLBACK —
 * and the discriminator is `reminder_kind`, not `reminder_count`.
 * `reminder_count` is `integer NOT NULL DEFAULT 0`, so every run in the table
 * reads 0 whether it has been reminded zero times or never considered; a
 * `count == null` test would be dead code that always says "nothing recorded"
 * and would hand a partner mid-cycle two extra nags. `reminder_kind` IS
 * nullable, so `run.reminder_kind === ruleKey` genuinely means "the legacy slot
 * is describing this rule".
 *
 * When the legacy slot describes a DIFFERENT rule it is ignored rather than
 * zeroed-into — that is the whole bug being fixed. Two rules alternating used
 * to reset each other's count, so neither ever reached the cap and the partner
 * was nagged forever.
 */
export function resolveReminderState(
  row: {
    rule_key?: string | null
    reminder_count?: number | null
    reminder_status?: string | null
    last_reminded_at?: Date | string | null
  } | null
    | undefined,
  run: {
    reminder_kind?: string | null
    reminder_count?: number | null
    reminder_status?: string | null
    last_reminded_at?: Date | string | null
  },
  ruleKey: string
): ReminderState {
  if (row) {
    return {
      reminder_kind: ruleKey,
      reminder_count: row.reminder_count ?? 0,
      reminder_status: row.reminder_status ?? null,
      last_reminded_at: row.last_reminded_at ?? null,
      from_legacy: false,
    }
  }

  if (run.reminder_kind && run.reminder_kind === ruleKey) {
    return {
      reminder_kind: ruleKey,
      reminder_count: run.reminder_count ?? 0,
      reminder_status: run.reminder_status ?? null,
      last_reminded_at: run.last_reminded_at ?? null,
      from_legacy: true,
    }
  }

  // No row, and the legacy slot belongs to some other rule (or to nothing).
  // This rule has never fired: a fresh counter, and — critically — the other
  // rule's counter is left exactly where it was.
  return {
    reminder_kind: null,
    reminder_count: 0,
    reminder_status: null,
    last_reminded_at: null,
    from_legacy: false,
  }
}

/**
 * Read the per-rule row for (run, rule), falling back to the run's legacy
 * columns. Returns the row id too, so the write knows whether to update or
 * create.
 *
 * ⚠️ The read is tolerant: if the table cannot be queried the fallback takes
 * over and the rule behaves exactly as it did before #2122 — the old
 * single-slot behaviour, which is the safe direction to fail in. The WRITE
 * below is deliberately NOT tolerant: a swallowed write means the count never
 * advances, the cap is never reached, and the partner is nagged forever.
 */
export async function loadReminderState(
  service: ProductionRunService,
  runId: string,
  ruleKey: string,
  run: Record<string, any>
): Promise<{ state: ReminderState; rowId: string | null }> {
  const rows = await (service as any)
    .listProductionRunReminders({ production_run_id: runId, rule_key: ruleKey })
    .catch(() => [])
  const row = Array.isArray(rows) ? rows[0] ?? null : null
  return { state: resolveReminderState(row, run, ruleKey), rowId: row?.id ?? null }
}

export async function persistReminderState(
  service: ProductionRunService,
  runId: string,
  ruleKey: string,
  rowId: string | null,
  patch: {
    reminder_count?: number
    reminder_status?: string | null
    last_reminded_at?: Date | null
  }
): Promise<void> {
  if (rowId) {
    await (service as any).updateProductionRunReminders({ id: rowId, ...patch })
    return
  }
  await (service as any).createProductionRunReminders({
    production_run_id: runId,
    rule_key: ruleKey,
    ...patch,
  })
}


/**
 * A per-rule row captured before a reset, so compensation can put it back.
 */
export type ReminderRowSnapshot = {
  production_run_id: string
  rule_key: string
  reminder_count: number
  reminder_status: string | null
  last_reminded_at: Date | string | null
}

/**
 * #2122 — wipe EVERY rule's counter for a run.
 *
 * Assignment and reassignment both rewind the run's own reminder columns to
 * untouched, on the reasoning that the new partner inherits none of the old
 * one's silence. Once counters live in their own rows that reasoning has to
 * reach them too, or a reassigned run arrives at its new partner already one
 * nag from the cap — and with free-form rules, one rule's stale count would
 * escalate work the new partner has had for a day.
 *
 * Returns what it removed so the compensation can restore it. A run with no
 * rows yet (every run, until this ships) returns `[]` and this is a no-op.
 */
export async function clearReminderRows(
  service: ProductionRunService,
  runId: string
): Promise<ReminderRowSnapshot[]> {
  const rows = await (service as any)
    .listProductionRunReminders({ production_run_id: runId })
    .catch(() => [])
  if (!Array.isArray(rows) || !rows.length) {
    return []
  }

  const snapshot: ReminderRowSnapshot[] = rows.map((r: any) => ({
    production_run_id: runId,
    rule_key: r.rule_key,
    reminder_count: r.reminder_count ?? 0,
    reminder_status: r.reminder_status ?? null,
    last_reminded_at: r.last_reminded_at ?? null,
  }))

  await (service as any).deleteProductionRunReminders(rows.map((r: any) => r.id))
  return snapshot
}

/**
 * Put back what `clearReminderRows` removed. The rows are re-created rather
 * than un-deleted, so they come back with new ids — nothing references a
 * reminder row by id, and the (run, rule) pair is the real key.
 */
export async function restoreReminderRows(
  service: ProductionRunService,
  snapshot: ReminderRowSnapshot[] | undefined | null
): Promise<void> {
  if (!snapshot?.length) {
    return
  }
  await (service as any).createProductionRunReminders(snapshot)
}
