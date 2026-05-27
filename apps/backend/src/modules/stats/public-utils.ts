/**
 * Shared helpers for the public (blog + REST) panel paths.
 * Two places resolve panels for non-admin consumers:
 *   1. inject-panel-data.ts — pre-injects data into TipTap nodes when
 *      serving a blog page
 *   2. api/web/stats/panels/[id]/data — direct REST read
 *
 * Both must enforce the same `metadata.public` gate AND apply the same
 * `display.exclude_columns` strip so a panel can't leak via one path
 * but be hidden by the other.
 */

/**
 * Mirrors the renderer's `resolveColumns` semantics on the backend so
 * public consumers can't ship rows with keys the editor told the
 * renderer to hide.
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
 * Public-gate check shared by the blog injector and the public REST
 * endpoint. Opt-in via `panel.metadata.public === true`.
 */
export function isPanelPublic(panel: { metadata?: any }): boolean {
  return ((panel?.metadata as Record<string, any>)?.public) === true
}
