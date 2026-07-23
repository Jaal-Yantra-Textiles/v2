/**
 * V4 admin-chat deprecation gate (#1092).
 *
 * The legacy "V4" admin chat (`/admin/ai/chat/chat` + `/admin/ai/chat/resolve`,
 * the Mastra `aiChatWorkflow` hybrid resolver) is superseded by the MCP-backed
 * Admin Assistant (`/admin/assistant/chat`). This flag retires it WITHOUT
 * deleting the code, so the cutover is reversible from config alone:
 *
 *   ADMIN_V4_CHAT_DEPRECATED=true   → the V4 routes return 410 and point callers
 *                                     at the new assistant.
 *   (unset / false, the default)    → V4 stays live; zero behavior change.
 *
 * No capability regresses: the V4 query-resolution is preserved as the admin
 * MCP `resolve_admin_query` tool (POST /admin/mcp/resolve-query), which the new
 * assistant can call.
 */
import { MedusaResponse } from "@medusajs/framework/http"

export function isV4ChatDeprecated(): boolean {
  const v = (process.env.ADMIN_V4_CHAT_DEPRECATED || "").trim().toLowerCase()
  return v === "true" || v === "1" || v === "yes"
}

export function respondV4Deprecated(res: MedusaResponse): void {
  res.status(410).json({
    deprecated: true,
    code: "admin_v4_chat_deprecated",
    message:
      "The V4 admin chat has been retired. Use the MCP-backed Admin Assistant " +
      "at /app/assistant (POST /admin/assistant/chat). The query-resolution " +
      "capability lives on as the admin MCP `resolve_admin_query` tool " +
      "(POST /admin/mcp/resolve-query), so nothing is lost.",
    replacement: {
      ui: "/app/assistant",
      chat: "/admin/assistant/chat",
      resolve: "/admin/mcp/resolve-query",
      resolve_tool: "resolve_admin_query",
    },
  })
}
