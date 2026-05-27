/**
 * Helpers used by `inject-panel-data.ts` when serving a blog page —
 * the only public consumer of panel data right now. (The REST endpoint
 * at `/web/stats/panels/:id/data` was removed pending a proper share-
 * publicly UX from the panel editor — see
 * `apps/docs/notes/PLATFORM_ROADMAP_2026_05.md` item #20.)
 *
 * If/when that ships, `isPanelPublic` can be re-introduced here as the
 * gate; until then, blog injector is the only public path and admin
 * authoring is the auth (admin embedded the panel in the post = admin
 * approved its surface).
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
