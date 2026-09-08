/**
 * Pure shaping for the MCP observability ledger view (#844).
 *
 * Lives apart from the route so the projection can be tested: the bug it exists
 * to prevent is a FIELD LIST that quietly disagrees with what was recorded.
 * `AiUsageService.recordMcpEvent` writes `method`, `path`, `outcome`,
 * `executed`, `ok`, `ms`, `error` and `context` into `metadata`, plus
 * `actor_id` on the row — and the view returned six of those and dropped the
 * rest. The summary could therefore report that N calls failed while no row
 * could say WHICH call, against WHAT, or WHY it was made.
 */

/** One ledger row as `listMcpUsage` returns it. */
export type McpUsageRow = {
  operation?: string | null
  surface?: string | null
  actor_id?: string | null
  actor_type?: string | null
  created_at?: unknown
  metadata?: {
    method?: string | null
    path?: string | null
    outcome?: string | null
    executed?: boolean | null
    ok?: boolean | null
    ms?: number | null
    error?: string | null
    context?: string | null
  } | null
}

/** Strip the `mcp:` prefix the ledger stores on `operation`. */
export const toolNameOf = (row: McpUsageRow): string =>
  String(row?.operation ?? "").replace(/^mcp:/, "")

export const summarizeMcpUsage = (
  rows: McpUsageRow[],
  total: number,
  recentLimit = 20
) => {
  const events = rows ?? []
  const bySurface: Record<string, number> = {}
  const byTool: Record<string, number> = {}
  // Which tools the failures belong to. A bare `errors: 3` says something is
  // wrong and nothing about where to look.
  const errorsByTool: Record<string, number> = {}
  let errors = 0

  for (const e of events) {
    const surface = e?.surface ?? "unknown"
    bySurface[surface] = (bySurface[surface] ?? 0) + 1
    const tool = toolNameOf(e)
    byTool[tool] = (byTool[tool] ?? 0) + 1
    // Strictly `=== false`: a row with no `ok` recorded is unknown, not a
    // failure, and counting it as one would invent errors out of old rows.
    if (e?.metadata?.ok === false) {
      errors++
      errorsByTool[tool] = (errorsByTool[tool] ?? 0) + 1
    }
  }

  return {
    total,
    returned: events.length,
    errors,
    by_surface: bySurface,
    by_tool: byTool,
    errors_by_tool: errorsByTool,
    recent: events.slice(0, recentLimit).map((e) => ({
      tool: toolNameOf(e),
      surface: e?.surface ?? null,
      actor_type: e?.actor_type ?? null,
      actor_id: e?.actor_id ?? null,
      outcome: e?.metadata?.outcome ?? null,
      // Distinct from `outcome`: a dry_run is a call that deliberately did NOT
      // execute, which is not the same as one that failed to.
      executed: e?.metadata?.executed ?? null,
      ok: e?.metadata?.ok ?? null,
      ms: e?.metadata?.ms ?? null,
      // What it actually hit — the difference between "create_inventory_order
      // ran" and "it POSTed /admin/inventory-orders".
      method: e?.metadata?.method ?? null,
      path: e?.metadata?.path ?? null,
      // The caller's own statement of intent, and the failure when there was
      // one. Null on rows that carried neither.
      context: e?.metadata?.context ?? null,
      error: e?.metadata?.error ?? null,
      at: e?.created_at ?? null,
    })),
  }
}
