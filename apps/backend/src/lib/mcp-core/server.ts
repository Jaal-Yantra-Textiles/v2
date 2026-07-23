/**
 * Shared MCP core — JSON-RPC server builder.
 *
 * Uses the low-level `Server` + `setRequestHandler` API (not the high-level
 * `McpServer.registerTool`) so tool input schemas stay as plain JSON Schema and
 * we avoid coupling to a specific zod version. Every tool is a loopback proxy
 * to a live route (see dispatch.ts / proxy.ts). The safety rails live in the
 * shared dispatcher, so the JSON-RPC endpoint and the in-app assistant behave
 * identically.
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js"
import type { McpContext, McpToolDef } from "./types"
import { dispatchMcpTool } from "./dispatch"
import {
  buildToolInputSchema,
  isDangerous,
  isSensitive,
  renderToolGuidance,
} from "./schema"

export type BuildMcpServerOptions = {
  /** MCP server identity, e.g. { name: "jyt-admin", version: "0.1.0" }. */
  serverInfo: { name: string; version: string }
  /** High-level usage instructions surfaced to MCP clients. */
  instructions: string
}

const textResult = (text: string, isError = false) => ({
  content: [{ type: "text" as const, text }],
  ...(isError ? { isError: true } : {}),
})

/**
 * Build an MCP `Server` over a registry + context. Tools are filtered by the
 * context's write/dangerous flags so disabled tools never appear in
 * `tools/list` (and are refused at dispatch as a backstop).
 */
export function buildMcpServer(
  ctx: McpContext,
  tools: McpToolDef[],
  opts: BuildMcpServerOptions
): Server {
  const server = new Server(opts.serverInfo, {
    capabilities: { tools: {} },
    instructions: opts.instructions,
  })

  const writeEnabled = ctx.enableWrite !== false
  const dangerousEnabled = ctx.enableDangerous === true
  const visibleTools = tools.filter(
    (t) =>
      (writeEnabled || !t.write) && (dangerousEnabled || !isDangerous(t))
  )

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: visibleTools.map((t) => ({
      name: t.name,
      description:
        t.description +
        (isDangerous(t)
          ? " [dangerous: requires confirm:true AND a reason]"
          : isSensitive(t)
          ? " [sensitive: requires confirm:true]"
          : "") +
        renderToolGuidance(t),
      inputSchema: buildToolInputSchema(t),
    })),
  }))

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const args = (req.params.arguments ?? {}) as Record<string, unknown>
    const result = await dispatchMcpTool(ctx, tools, req.params.name, args)
    return textResult(JSON.stringify(result, null, 2), !result.ok)
  })

  return server
}
