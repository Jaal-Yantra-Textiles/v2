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
export {
  MCP_SCOPE_LEVELS,
  isMcpScopeLevel,
  mcpScopeRank,
  minMcpScope,
  mcpScopeAllows,
  mcpToolTier,
  type McpScopeLevel,
} from "./tiers"
export { dispatchMcpTool } from "./dispatch"
export {
  executeMcpPlan,
  navPlanPath,
  isEmptyPlanResult,
  broadenPlanArgs,
  PLAN_SCOPE_GUIDANCE,
  type McpPlanStep,
  type McpPlan,
  type McpPlanFallback,
  type McpPlanMapResult,
  type ExecutePlanOptions,
  type McpPlanResult,
  type EntityResolver,
} from "./plan"
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
export { widenedDomainsFromHistory } from "./tool-slice"
