/**
 * MCP scope vocabulary — the ladder, the process ceiling, and the resolver
 * (#1306 Track C).
 *
 * Two independent things decide what a caller may do through MCP:
 *
 *   1. the PROCESS CEILING — `ADMIN_MCP_ENABLE_WRITE` (default true) and
 *      `ADMIN_MCP_ENABLE_DANGEROUS` (default false), env flags that apply to
 *      the whole deployment; and
 *   2. the PRINCIPAL'S SCOPE — an `mcp_access_scope` row for this specific
 *      credential.
 *
 * The effective level is `min(ceiling, row)`. A row can only ever restrict:
 * widening still needs the env flag, so a bad scope row cannot turn a
 * read-only deployment into a write one. No row at all means "whatever the
 * process allows", which is exactly the behaviour that existed before this
 * module — so nothing changes until a row is written.
 *
 * Everything here is pure except `loadMcpScopeLevel`, which does one indexed
 * lookup. There is deliberately NO cache: the lookup runs on admin writes and
 * MCP tool calls only (never on dashboard reads), and a cache would mean a
 * revoked scope keeps working for its TTL — the wrong trade for a permission.
 */
import type { MedusaRequest } from "@medusajs/framework/http"
import {
  isMcpScopeLevel,
  mcpScopeAllows,
  minMcpScope,
  type McpScopeLevel,
} from "./mcp-core/tiers"
import { MCP_ACCESS_MODULE } from "../modules/mcp_access"
import type McpAccessService from "../modules/mcp_access/service"

/**
 * The ladder itself lives in `mcp-core/tiers` — dependency-free, so the
 * dispatcher and the admin dashboard bundle can share it without dragging in
 * the module resolution below. Re-exported here because this is the import path
 * every caller already uses.
 */
export {
  MCP_SCOPE_LEVELS,
  isMcpScopeLevel,
  mcpScopeRank,
  minMcpScope,
  mcpScopeAllows,
  mcpToolTier,
} from "./mcp-core/tiers"
export type { McpScopeLevel } from "./mcp-core/tiers"

/**
 * Translate a level into the three flags `McpContext` already understands.
 * `sensitive` covers the confirm-gated tools (every DELETE is implicitly one);
 * `dangerous` covers the ones that additionally demand a human reason.
 */
export const mcpScopeToContextFlags = (
  level: McpScopeLevel
): {
  enableWrite: boolean
  enableSensitive: boolean
  enableDangerous: boolean
} => ({
  enableWrite: mcpScopeAllows(level, "write"),
  enableSensitive: mcpScopeAllows(level, "sensitive"),
  enableDangerous: mcpScopeAllows(level, "dangerous"),
})

/**
 * The process ceiling expressed on the ladder.
 *
 * Note the middle rung: with writes on but dangerous off — the default
 * deployment — the ceiling is "sensitive", because confirm-gated tools have
 * always been callable in that configuration. Only `dangerous` was ever gated
 * separately, and this preserves that exactly.
 */
export const mcpCeilingLevel = (flags: {
  write: boolean
  dangerous: boolean
}): McpScopeLevel =>
  !flags.write ? "read" : flags.dangerous ? "dangerous" : "sensitive"

/** The authenticated principal a scope row can be attached to. */
export type McpPrincipal = {
  /** Medusa `auth_context.actor_type`: "api-key" | "user" | … */
  type: string
  /** Medusa `auth_context.actor_id`: `apk_…` for a secret API key. */
  id: string
}

/**
 * Principal for a request, or null when unauthenticated.
 *
 * For a secret API key Medusa sets `{ actor_id: <api_key.id>, actor_type:
 * "api-key" }` (see the framework's authenticate middleware — API keys are the
 * one hard-coded actor type). For a dashboard session or admin JWT it is the
 * user id with `actor_type: "user"`.
 */
export const mcpPrincipalFromRequest = (
  req: MedusaRequest
): McpPrincipal | null => {
  const ctx = (req as any).auth_context
  const id = ctx?.actor_id
  const type = ctx?.actor_type
  if (typeof id !== "string" || !id || typeof type !== "string" || !type) {
    return null
  }
  return { type, id }
}

/**
 * Machine principals — the ones an HTTP-level restriction is meaningful for.
 *
 * A human admin holds a dashboard session and can perform any mutation through
 * the UI, so refusing their raw HTTP writes would restrict nothing while
 * risking locking a real person out. Their scope row (if any) still narrows the
 * MCP tool surface; it just isn't enforced on ordinary `/admin/*` routes.
 */
export const MCP_MACHINE_PRINCIPAL_TYPES: readonly string[] = [
  "api-key",
  "oauth",
]

export const isMcpMachinePrincipal = (principal: McpPrincipal): boolean =>
  MCP_MACHINE_PRINCIPAL_TYPES.includes(principal.type)

/**
 * Non-GET `/admin/*` paths a read-scoped machine credential may still call.
 *
 * The HTTP guard (`src/api/middlewares.ts`) classifies by verb, but the registry
 * classifies by its `write` flag, and the two disagree for POSTs that only read:
 *
 *   - `/admin/mcp` is the JSON-RPC transport — EVERY tool call is a POST,
 *     including reads. Scope is enforced per-tool inside the dispatcher instead,
 *     and the loopback call it then makes re-enters the guard for the real
 *     route, so a read-only token still cannot reach a mutation through it.
 *   - `/admin/mcp/resolve-query` is a POST that only plans (`resolve_admin_query`,
 *     correctly not flagged `write`).
 *   - `/admin/assistant/vision` is a POST that only looks at an already-stored
 *     image (`read_image`). It is POST because the image reference goes in the
 *     body, not because anything changes.
 *
 * An invariant test asserts every non-GET tool that is not flagged `write` has
 * its path listed here — so a future read-only POST tool fails the suite instead
 * of silently 403ing for read-only credentials.
 */
export const MCP_SCOPE_EXEMPT_ADMIN_PATHS: readonly string[] = [
  "/admin/mcp",
  "/admin/mcp/resolve-query",
  "/admin/assistant/vision",
]

export type ResolvedMcpScope = {
  /** The effective level after intersecting the row with the ceiling. */
  level: McpScopeLevel
  /** Where it came from — "ceiling" means no row existed for this principal. */
  source: "ceiling" | "scope_row"
  /** The row's own level, before intersection (for diagnostics/audit). */
  granted?: McpScopeLevel
}

/**
 * Read this principal's stored level, if any. Returns null both when no row
 * exists and when the module is unavailable — the caller falls back to the
 * ceiling, so a missing module degrades to today's behaviour rather than
 * locking every credential out.
 */
export const loadMcpScopeLevel = async (
  container: MedusaRequest["scope"],
  principal: McpPrincipal
): Promise<McpScopeLevel | null> => {
  let service: McpAccessService
  try {
    service = container.resolve(MCP_ACCESS_MODULE) as McpAccessService
  } catch {
    return null
  }
  const row = await service.getScope(principal.type, principal.id)
  if (!row) return null
  return isMcpScopeLevel(row.level) ? row.level : "read"
}

/**
 * Effective scope for a request: `min(ceiling, stored row)`.
 *
 * `ceiling` is supplied by the caller (each surface owns its own env flags),
 * keeping this module free of surface-specific configuration.
 */
export const resolveMcpScope = async (
  req: MedusaRequest,
  ceiling: McpScopeLevel
): Promise<ResolvedMcpScope> => {
  const principal = mcpPrincipalFromRequest(req)
  if (!principal) {
    return { level: ceiling, source: "ceiling" }
  }
  const granted = await loadMcpScopeLevel(req.scope, principal)
  if (!granted) {
    return { level: ceiling, source: "ceiling" }
  }
  return { level: minMcpScope(ceiling, granted), source: "scope_row", granted }
}
