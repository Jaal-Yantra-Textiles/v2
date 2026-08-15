/**
 * Shared request handler for the Admin MCP transport, mounted at
 * POST /admin/mcp (admin-user-authenticated — all /admin/* routes are).
 *
 * Thin wrapper over the shared mcp-core transport helpers: build an
 * admin-scoped server (auth captured from the request) and hand Medusa's
 * already-parsed JSON-RPC body to the stateless Streamable-HTTP transport.
 *
 * Two env flags set the process-wide CEILING for the write surface:
 *   - ADMIN_MCP_ENABLE_WRITE      (default true)  — write tools (non-GET).
 *   - ADMIN_MCP_ENABLE_DANGEROUS  (default false) — platform-destructive tools.
 *
 * The ceiling is then narrowed per credential by an `mcp_access_scope` row
 * (#1306 Track C), which is what makes a read-only token possible. No row means
 * the ceiling, i.e. the behaviour that existed before scopes. The intersection
 * only ever restricts — see `src/lib/mcp-scope.ts`.
 *
 * ⚠️ Scope enforced HERE governs the tool surface only. A secret API key also
 * authenticates plain `/admin/*` routes, so the same scope is enforced again by
 * the admin write guard in `src/api/middlewares.ts` — without that, a read-only
 * scope would be bypassable by calling the wrapped route directly.
 */
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import {
  buildMcpServer,
  handleMcpJsonRpc,
  mcpMethodNotAllowed,
  resolveLoopbackBaseUrl,
  envFlagDefaultTrue,
  envFlagDefaultFalse,
} from "../../../../lib/mcp-core"
import { makeMcpLedgerSink } from "../../../../lib/mcp-ledger"
import { isDangerous, isSensitive } from "../../../../lib/mcp-core"
import {
  MCP_SCOPE_LEVELS,
  mcpCeilingLevel,
  mcpScopeToContextFlags,
  resolveMcpScope,
  type McpScopeLevel,
  type ResolvedMcpScope,
} from "../../../../lib/mcp-scope"
import { ADMIN_MCP_TOOLS } from "./registry"

const SERVER_INFO = { name: "jyt-admin", version: "0.1.0" } as const

const INSTRUCTIONS =
  "JYT Admin MCP — drive the platform via the Admin API. Tools cover reads across " +
  "orders, products, customers, partners, stores, designs, production runs, " +
  "inventory, payments, campaigns and notifications, plus writes for the catalog, " +
  "partner ops, order fulfillment and order edits, the production-run lifecycle " +
  "(create -> approve/assign -> dispatch -> cancel) and the design -> production " +
  "pipeline. Every tool accepts a `dry_run` flag. Sensitive/destructive tools " +
  "require `confirm: true`, and platform-destructive ('dangerous') tools " +
  "additionally require a human `reason` — never confirm or invent a reason on " +
  "the admin's behalf. Start by calling get_admin_stats to ground yourself."

/** Write tools are on by default; a deployment can force read-only. */
export function isAdminWriteEnabled(): boolean {
  return envFlagDefaultTrue("ADMIN_MCP_ENABLE_WRITE")
}

/** Dangerous (platform-destructive) tools are OFF unless explicitly enabled. */
export function isAdminDangerousEnabled(): boolean {
  return envFlagDefaultFalse("ADMIN_MCP_ENABLE_DANGEROUS")
}

/**
 * Loopback origin for proxying to /admin/* on this same process. Derived from
 * the incoming request by default; override with ADMIN_MCP_LOOPBACK_URL.
 */
export function resolveAdminBaseUrl(req: MedusaRequest): string {
  return resolveLoopbackBaseUrl(req, "ADMIN_MCP_LOOPBACK_URL")
}

/** The process-wide ceiling on the scope ladder, from the two env flags. */
export function adminMcpCeiling(): McpScopeLevel {
  return mcpCeilingLevel({
    write: isAdminWriteEnabled(),
    dangerous: isAdminDangerousEnabled(),
  })
}

/**
 * How many tools each level actually exposes, using the same filter the server
 * applies to `tools/list`.
 *
 * Surfaced by `/admin/mcp/scopes` because the ladder alone hides something an
 * operator needs to see: every admin write tool is currently `sensitive`, so
 * scoping a credential to `write` exposes exactly what `read` does. A number
 * next to the level makes that obvious at the moment of choosing it, instead of
 * after the third-party client starts refusing every call.
 */
export function adminToolCountsByLevel(): Record<McpScopeLevel, number> {
  const counts = {} as Record<McpScopeLevel, number>
  for (const level of MCP_SCOPE_LEVELS) {
    const f = mcpScopeToContextFlags(level)
    counts[level] = ADMIN_MCP_TOOLS.filter(
      (t) =>
        (f.enableWrite || !t.write) &&
        (f.enableDangerous || !isDangerous(t)) &&
        (f.enableSensitive || !isSensitive(t))
    ).length
  }
  return counts
}

/** Effective scope for this request: min(process ceiling, credential's row). */
export async function resolveAdminMcpScope(
  req: MedusaRequest
): Promise<ResolvedMcpScope> {
  return resolveMcpScope(req, adminMcpCeiling())
}

export function buildAdminMcpServer(
  req: MedusaRequest,
  /** Defaults to the process ceiling so existing callers keep their behaviour. */
  level: McpScopeLevel = adminMcpCeiling()
): Server {
  const actorId = (req as any).auth_context?.actor_id as string | undefined
  return buildMcpServer(
    {
      baseUrl: resolveAdminBaseUrl(req),
      bearer: req.get("authorization") || undefined,
      cookie: req.get("cookie") || undefined,
      ...mcpScopeToContextFlags(level),
      surface: "admin",
      observe: makeMcpLedgerSink(req.scope, {
        id: actorId ?? null,
        type: "admin",
      }),
    },
    ADMIN_MCP_TOOLS,
    { serverInfo: SERVER_INFO, instructions: INSTRUCTIONS }
  )
}

export async function handleAdminMcpRequest(
  req: MedusaRequest,
  res: MedusaResponse
): Promise<void> {
  const { level } = await resolveAdminMcpScope(req)
  await handleMcpJsonRpc(req, res, buildAdminMcpServer(req, level))
}

export function adminMcpMethodNotAllowed(
  req: MedusaRequest,
  res: MedusaResponse
): void {
  mcpMethodNotAllowed(req, res)
}
