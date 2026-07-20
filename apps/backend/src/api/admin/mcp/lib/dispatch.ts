/**
 * Admin-MCP tool dispatcher — thin wrapper over the shared mcp-core.
 *
 * Binds the core dispatcher to the Admin registry and stamps the "admin"
 * surface. The three safety rails (dry_run preview, sensitive/DELETE confirm,
 * dangerous/reason) live in the shared dispatcher, so the JSON-RPC MCP endpoint
 * and the in-app admin assistant behave identically. Re-exports the schema
 * helpers so the chat route and tests share one source of truth.
 */
import {
  dispatchMcpTool,
  type McpContext,
  type McpToolResult,
} from "../../../../lib/mcp-core"
import { ADMIN_MCP_TOOLS } from "./registry"

export {
  buildToolInputSchema,
  isSensitive,
  isDangerous,
} from "../../../../lib/mcp-core"

/** Admin dispatch context (auth + write/dangerous flags). Alias of core context. */
export type AdminMcpContext = McpContext
/** Structured tool result. Alias of the core result. */
export type AdminToolResult = McpToolResult

export async function dispatchAdminTool(
  ctx: AdminMcpContext,
  name: string,
  rawArgs: Record<string, unknown> = {}
): Promise<AdminToolResult> {
  return dispatchMcpTool(
    { ...ctx, surface: "admin" },
    ADMIN_MCP_TOOLS,
    name,
    rawArgs
  )
}
