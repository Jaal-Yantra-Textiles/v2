/**
 * Loopback proxy to the Partner API — thin re-export of the shared mcp-core
 * proxy. Kept as a surface-local module so existing `callPartnerRoute` imports
 * keep working; the implementation is now the generic `callMcpRoute`.
 */
export {
  callMcpRoute as callPartnerRoute,
  type McpProxyArgs as PartnerProxyArgs,
  type McpProxyError as PartnerProxyError,
} from "../../../../lib/mcp-core"
