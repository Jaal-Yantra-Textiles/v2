/**
 * Shared helpers for the public (blog + REST) panel paths.
 *
 * Two places resolve panels for non-admin consumers:
 *   1. inject-panel-data.ts — pre-injects data into TipTap nodes when
 *      serving a blog page. Admin authoring is the auth there (the admin
 *      embedded the panel in the post = approved its surface), so the
 *      blog injector is intentionally NOT `metadata.public`-gated.
 *   2. api/web/stats/panels/[id]/data — the direct, opt-in public REST
 *      read. This path IS `isPanelPublic`-gated: only panels an admin
 *      explicitly shared resolve; everything else returns the same 404
 *      as a non-existent id (so private panels can't be enumerated).
 *
 * Both apply the same `display.exclude_columns` strip so a panel can't
 * leak columns via one path that the other hides.
 *
 * Restored for roadmap #20 / issue #341 (share-publicly UX). The earlier
 * removal (PR #284) deferred the gate to this proper share flow; the
 * blog-injector gate was dropped separately (PR #283) on purpose and is
 * NOT reinstated here.
 */

/**
 * Mirrors the admin renderer's `resolveColumns` semantics on the
 * backend so public consumers can't ship rows with keys the editor
 * told the renderer to hide (e.g. a `raw_materials` panel that joins
 * `inventory_item.*` for context).
 *
 * Returns a shallow clone with `records` / `groups` stripped of denied
 * keys. Falls through unchanged when there's nothing to strip.
 */
export function stripExcludedColumns(
  display: Record<string, any> | undefined,
  data: any
): any {
  const deny = new Set<string>(
    Array.isArray(display?.exclude_columns)
      ? (display!.exclude_columns as string[])
      : []
  )
  if (deny.size === 0 || !data || typeof data !== "object") return data

  const records = (data as any).records ?? (data as any).groups
  if (!Array.isArray(records)) return data

  const stripped = records.map((row: any) => {
    if (!row || typeof row !== "object") return row
    const out: Record<string, any> = {}
    for (const [k, v] of Object.entries(row)) {
      if (!deny.has(k)) out[k] = v
    }
    return out
  })
  return {
    ...(data as Record<string, any>),
    records: (data as any).records !== undefined ? stripped : undefined,
    groups: (data as any).groups !== undefined ? stripped : undefined,
  }
}

/**
 * Public-gate check shared by the public REST endpoint. A panel is
 * shared only when an admin explicitly opted in via
 * `metadata.public === true`. Default (missing / any other value) is
 * private.
 */
export function isPanelPublic(panel: { metadata?: any }): boolean {
  return ((panel?.metadata as Record<string, any>)?.public) === true
}

/**
 * Maintain share-audit fields on a panel-update payload. Pure so the
 * route stays thin and the logic is unit-testable without a DB.
 *
 * The PUT route keeps its existing **full-replace** metadata semantics
 * (Medusa replaces the whole `metadata` blob), so this helper guards the
 * two audit keys against being lost or spoofed:
 *
 * - **On a real toggle** (`incoming.public` differs from the panel's
 *   current value) it stamps `public_set_by` (admin actor id) +
 *   `public_set_at` (ISO ts) from the server — the source of truth, so
 *   any client-supplied audit keys are overwritten.
 * - **On a non-toggling edit while the panel stays public** it carries
 *   forward the existing stamps if the payload dropped them, so an
 *   unrelated metadata edit doesn't silently erase the audit trail.
 * - Otherwise (no metadata in the payload, or panel stays private) it
 *   returns `incoming` unchanged (same ref → no churn).
 */
export function applyPublicAuditStamp(
  current: Record<string, any> | undefined | null,
  incoming: Record<string, any> | undefined,
  actorId: string | undefined | null,
  nowIso: string
): Record<string, any> | undefined {
  if (incoming === undefined) return incoming

  const cur = (current ?? undefined) as Record<string, any> | undefined
  const wasPublic = cur?.public === true
  const willBePublic = (incoming as Record<string, any>)?.public === true

  if (wasPublic !== willBePublic) {
    return {
      ...incoming,
      public_set_by: actorId ?? null,
      public_set_at: nowIso,
    }
  }

  // No toggle. If it stays public, preserve prior stamps the payload omitted.
  if (willBePublic) {
    const out = { ...incoming }
    let changed = false
    if (out.public_set_by === undefined && cur?.public_set_by !== undefined) {
      out.public_set_by = cur.public_set_by
      changed = true
    }
    if (out.public_set_at === undefined && cur?.public_set_at !== undefined) {
      out.public_set_at = cur.public_set_at
      changed = true
    }
    return changed ? out : incoming
  }

  return incoming
}
