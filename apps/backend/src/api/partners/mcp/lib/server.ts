/**
 * Builds the Partner MCP server — thin wrapper over the shared mcp-core.
 *
 * The generic JSON-RPC server (tools/list + tools/call over a registry, with
 * the dry_run/confirm rails in the shared dispatcher) lives in `lib/mcp-core`.
 * This module supplies the Partner registry, server identity and instructions,
 * and stamps the "partner" surface.
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { buildMcpServer } from "../../../../lib/mcp-core"
import { PARTNER_MCP_TOOLS } from "./registry"
import type { PartnerMcpContext } from "./dispatch"

const SERVER_INFO = { name: "jyt-partner", version: "0.1.0" } as const

const INSTRUCTIONS =
  "JYT Partner MCP — drive the partner portal via the Partner API. Tools cover " +
  "profile & persona/onboarding, UI layout personalization, and reads across " +
  "orders, products, stores, designs and inventory. All tools accept a " +
  "`dry_run` flag to preview the request (and, for writes, the current object) " +
  "without executing. Sensitive/destructive tools (deletes, resets) require an " +
  "explicit `confirm: true` — surface them to the user for approval rather than " +
  "confirming on their behalf. Start by calling get_partner_profile."

export function buildPartnerMcpServer(ctx: PartnerMcpContext): Server {
  return buildMcpServer({ ...ctx, surface: "partner" }, PARTNER_MCP_TOOLS, {
    serverInfo: SERVER_INFO,
    instructions: INSTRUCTIONS,
  })
}
