/**
 * Shared request handler for the Admin MCP transport, mounted at
 * POST /admin/mcp (admin-user-authenticated — all /admin/* routes are).
 *
 * Thin wrapper over the shared mcp-core transport helpers: build an
 * admin-scoped server (auth captured from the request) and hand Medusa's
 * already-parsed JSON-RPC body to the stateless Streamable-HTTP transport.
 *
 * Two env flags gate the write surface:
 *   - ADMIN_MCP_ENABLE_WRITE      (default true)  — write tools (non-GET).
 *   - ADMIN_MCP_ENABLE_DANGEROUS  (default false) — platform-destructive tools.
 * Tier 1 is read-only, so neither flag affects it yet; they are wired now so
 * later tiers land safe-by-default.
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
import { ADMIN_MCP_TOOLS } from "./registry"

const SERVER_INFO = { name: "jyt-admin", version: "0.1.0" } as const

const INSTRUCTIONS =
  "JYT Admin MCP — drive the platform via the Admin API. Tools currently cover " +
  "read-only breadth: orders, products, customers, partners, stores, designs, " +
  "production runs, inventory, payments, campaigns and notifications. Every tool " +
  "accepts a `dry_run` flag. Sensitive/destructive tools require `confirm: true`, " +
  "and platform-destructive ('dangerous') tools additionally require a human " +
  "`reason` — never confirm or invent a reason on the admin's behalf. Start by " +
  "calling get_admin_stats to ground yourself."

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

export function buildAdminMcpServer(req: MedusaRequest): Server {
  return buildMcpServer(
    {
      baseUrl: resolveAdminBaseUrl(req),
      bearer: req.get("authorization") || undefined,
      cookie: req.get("cookie") || undefined,
      enableWrite: isAdminWriteEnabled(),
      enableDangerous: isAdminDangerousEnabled(),
      surface: "admin",
    },
    ADMIN_MCP_TOOLS,
    { serverInfo: SERVER_INFO, instructions: INSTRUCTIONS }
  )
}

export async function handleAdminMcpRequest(
  req: MedusaRequest,
  res: MedusaResponse
): Promise<void> {
  await handleMcpJsonRpc(req, res, buildAdminMcpServer(req))
}

export function adminMcpMethodNotAllowed(
  req: MedusaRequest,
  res: MedusaResponse
): void {
  mcpMethodNotAllowed(req, res)
}
