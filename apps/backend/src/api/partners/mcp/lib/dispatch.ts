/**
 * Partner-MCP tool dispatcher — thin wrapper over the shared mcp-core.
 *
 * The dispatch logic and the two safety rails (dry_run preview, sensitive/DELETE
 * confirmation) now live in `lib/mcp-core`. This module binds the core
 * dispatcher to the Partner registry and stamps the "partner" surface, and
 * re-exports the schema helpers so existing imports (chat route, tests) keep
 * working. It is the single execution path for both the JSON-RPC MCP endpoint
 * and the in-app assistant.
 */
import {
  dispatchMcpTool,
  type McpContext,
  type McpToolResult,
} from "../../../../lib/mcp-core"
import { PARTNER_MCP_TOOLS } from "./registry"

export { buildToolInputSchema, isSensitive } from "../../../../lib/mcp-core"

/** Partner dispatch context (auth + write flag). Alias of the core context. */
export type PartnerMcpContext = McpContext
/** Structured tool result. Alias of the core result. */
export type PartnerToolResult = McpToolResult

export async function dispatchPartnerTool(
  ctx: PartnerMcpContext,
  name: string,
  rawArgs: Record<string, unknown> = {}
): Promise<PartnerToolResult> {
  return dispatchMcpTool(
    { ...ctx, surface: "partner" },
    PARTNER_MCP_TOOLS,
    name,
    rawArgs
  )
}
