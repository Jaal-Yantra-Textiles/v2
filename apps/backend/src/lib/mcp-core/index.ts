/**
 * Shared MCP core — barrel.
 *
 * One declarative tool model + dispatch/proxy/schema/server/observability,
 * reused by every MCP surface (store, partner, admin). A surface supplies its
 * own `McpToolDef[]` registry and an auth-scoped `McpContext`; the core owns
 * execution and the safety rails (dry_run / confirm / reason).
 */
export type {
  McpMethod,
  McpToolDef,
  McpContext,
  McpToolResult,
  McpToolEvent,
} from "./types"
export {
  isSensitive,
  isDangerous,
  renderToolGuidance,
  buildToolInputSchema,
} from "./schema"
export { dispatchMcpTool } from "./dispatch"
export { callMcpRoute, type McpProxyArgs, type McpProxyError } from "./proxy"
export { buildMcpServer, type BuildMcpServerOptions } from "./server"
export {
  handleMcpJsonRpc,
  mcpMethodNotAllowed,
  resolveLoopbackBaseUrl,
  envFlagDefaultTrue,
  envFlagDefaultFalse,
} from "./handler"
export { makeMcpLogSink } from "./observability"
