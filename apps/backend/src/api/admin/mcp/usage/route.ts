/**
 * GET /admin/mcp/usage — the MCP observability ledger view (#844).
 *
 * Reads the `ai_usage_event` rows written by every MCP tool dispatch (across
 * the store / partner / admin surfaces) and returns an aggregated snapshot:
 * totals, per-surface and per-tool counts, error count, and the most recent
 * calls. Backs the `get_mcp_usage` admin MCP tool so the assistant can answer
 * "how is the MCP being used / what's failing".
 *
 * Query params: `surface` (optional filter), `limit` (default 50, max 200).
 */
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { AI_USAGE_MODULE } from "../../../../modules/ai_usage"
import type AiUsageService from "../../../../modules/ai_usage/service"

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const aiUsage = req.scope.resolve(AI_USAGE_MODULE) as AiUsageService

  const surface =
    typeof req.query.surface === "string" ? req.query.surface : undefined
  const limit = Math.min(Number(req.query.limit) || 50, 200)

  const { events, count } = await aiUsage.listMcpUsage({ surface, limit })

  const bySurface: Record<string, number> = {}
  const byTool: Record<string, number> = {}
  let errors = 0

  for (const e of events as any[]) {
    const s = e.surface ?? "unknown"
    bySurface[s] = (bySurface[s] ?? 0) + 1
    const tool = String(e.operation ?? "").replace(/^mcp:/, "")
    byTool[tool] = (byTool[tool] ?? 0) + 1
    if (e.metadata?.ok === false) errors++
  }

  res.json({
    usage: {
      total: count,
      returned: events.length,
      errors,
      by_surface: bySurface,
      by_tool: byTool,
      recent: (events as any[]).slice(0, 20).map((e) => ({
        tool: String(e.operation ?? "").replace(/^mcp:/, ""),
        surface: e.surface,
        actor_type: e.actor_type,
        outcome: e.metadata?.outcome ?? null,
        ok: e.metadata?.ok ?? null,
        ms: e.metadata?.ms ?? null,
        at: e.created_at,
      })),
    },
  })
}
