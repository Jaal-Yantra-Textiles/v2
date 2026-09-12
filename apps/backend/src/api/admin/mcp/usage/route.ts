/**
 * GET /admin/mcp/usage — the MCP observability ledger view (#844).
 *
 * Reads the `ai_usage_event` rows written by every MCP tool dispatch (across
 * the store / partner / admin surfaces) and returns an aggregated snapshot:
 * totals, per-surface and per-tool counts, error count, and the most recent
 * calls. Backs the `get_mcp_usage` admin MCP tool so the assistant can answer
 * "how is the MCP being used / what's failing".
 *
 * Query params: `surface` (optional filter), `limit` (default 50, max 200),
 * and a time window — `days` (last N days from now) OR explicit `from` / `to`
 * ISO dates (which win when both are given). The effective window is echoed
 * back on the payload so a reader can see which period a number describes;
 * an empty result for a window means no rows in that window, not "no usage
 * ever". The caller's `limit` also drives the `recent` list via `recentLimit`,
 * so asking for 200 rows actually returns 200, not a hardcoded 20.
 */
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { AI_USAGE_MODULE } from "../../../../modules/ai_usage"
import type AiUsageService from "../../../../modules/ai_usage/service"
import { parseMcpUsageWindow } from "../../../../modules/ai_usage/lib/mcp-window"
import { summarizeMcpUsage } from "./summarize"

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const aiUsage = req.scope.resolve(AI_USAGE_MODULE) as AiUsageService

  const surface =
    typeof req.query.surface === "string" ? req.query.surface : undefined
  const limit = Math.min(Number(req.query.limit) || 50, 200)

  const { from, to } = parseMcpUsageWindow(req.query)

  const { events, count } = await aiUsage.listMcpUsage({
    surface,
    limit,
    from,
    to,
  })

  const window = {
    from: from ? from.toISOString() : null,
    to: to ? to.toISOString() : null,
  }

  res.json({
    usage: summarizeMcpUsage(events as any[], count, limit, window),
    window,
  })
}
