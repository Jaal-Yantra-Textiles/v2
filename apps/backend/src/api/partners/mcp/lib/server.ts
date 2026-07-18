/**
 * Builds the Partner MCP server.
 *
 * Uses the low-level `Server` + `setRequestHandler` API (not the high-level
 * `McpServer.registerTool`) so tool input schemas stay as plain JSON Schema and
 * we avoid coupling to a specific zod version.
 *
 * Every tool is a loopback proxy to a live `/partners/*` route (see
 * dispatch.ts / proxy.ts), authenticated with the forwarded partner JWT — so it
 * inherits the route's ownership scoping, validators and workflow logic. The
 * two safety rails (dry_run preview, sensitive/DELETE confirmation) live in the
 * shared dispatcher, so the JSON-RPC endpoint and the in-app assistant behave
 * identically.
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js"
import { PARTNER_MCP_TOOLS, renderToolGuidance } from "./registry"
import {
  dispatchPartnerTool,
  buildToolInputSchema,
  isSensitive,
  type PartnerMcpContext,
} from "./dispatch"

const SERVER_INFO = { name: "jyt-partner", version: "0.1.0" } as const

const INSTRUCTIONS =
  "JYT Partner MCP — drive the partner portal via the Partner API. Tools cover " +
  "profile & persona/onboarding, UI layout personalization, and reads across " +
  "orders, products, stores, designs and inventory. All tools accept a " +
  "`dry_run` flag to preview the request (and, for writes, the current object) " +
  "without executing. Sensitive/destructive tools (deletes, resets) require an " +
  "explicit `confirm: true` — surface them to the user for approval rather than " +
  "confirming on their behalf. Start by calling get_partner_profile."

const textResult = (text: string, isError = false) => ({
  content: [{ type: "text" as const, text }],
  ...(isError ? { isError: true } : {}),
})

export function buildPartnerMcpServer(ctx: PartnerMcpContext): Server {
  const server = new Server(SERVER_INFO, {
    capabilities: { tools: {} },
    instructions: INSTRUCTIONS,
  })

  const writeEnabled = ctx.enableWrite !== false
  const visibleTools = PARTNER_MCP_TOOLS.filter(
    (t) => writeEnabled || !t.write
  )

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: visibleTools.map((t) => ({
      name: t.name,
      description:
        t.description +
        (isSensitive(t) ? " [sensitive: requires confirm:true]" : "") +
        renderToolGuidance(t),
      inputSchema: buildToolInputSchema(t),
    })),
  }))

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const args = (req.params.arguments ?? {}) as Record<string, unknown>
    const result = await dispatchPartnerTool(ctx, req.params.name, args)
    return textResult(JSON.stringify(result, null, 2), !result.ok)
  })

  return server
}
