/**
 * Admin MCP confirm bridge (#1092).
 *
 * The admin assistant's sensitive/dangerous tools never auto-execute — the chat
 * endpoint returns `requires_confirmation` (and `requires_reason` for dangerous
 * tools) and the UI shows an approval card. On approve we call the Admin MCP
 * JSON-RPC endpoint DIRECTLY (bypassing the model) with `confirm: true` (and the
 * operator's `reason`), re-issuing the exact tool + arguments the model
 * proposed. This is the single sanctioned path for running a guarded tool.
 *
 * The endpoint runs stateless Streamable HTTP with `enableJsonResponse`, so a
 * single POST returns a plain JSON-RPC body (it may also arrive as an SSE
 * `data:` frame — we parse both). Admin auth is the session cookie, so the
 * request is sent with credentials.
 */
import { API_BASE_URL } from "./config"

/** Mirrors the backend AdminToolResult (mcp-core). */
export type AdminToolResult = {
  ok: boolean
  tool: string
  data?: unknown
  error?: string
  dry_run?: boolean
  requires_confirmation?: boolean
  requires_reason?: boolean
  plan?: Record<string, unknown>
  current?: unknown
  warning?: string
}

/** Extract the JSON-RPC envelope from a plain-JSON or SSE-framed response body. */
function parseRpcBody(text: string): any {
  const trimmed = text.trim()
  if (trimmed.startsWith("{")) return JSON.parse(trimmed)
  // SSE frame: pull the last `data:` line and parse it.
  const dataLine = trimmed
    .split("\n")
    .reverse()
    .find((l) => l.startsWith("data:"))
  if (dataLine) return JSON.parse(dataLine.slice(5).trim())
  throw new Error("Unrecognized MCP response body")
}

/**
 * Execute an admin tool via the MCP endpoint. `args` are the arguments the
 * model proposed; `confirm: true` (and any `reason`) are added here for the
 * sensitive/dangerous gates.
 */
export async function runAdminMcpTool(
  name: string,
  args: Record<string, unknown>,
  opts: { reason?: string } = {}
): Promise<AdminToolResult> {
  const body = {
    jsonrpc: "2.0",
    id: Date.now(),
    method: "tools/call",
    params: {
      name,
      arguments: {
        ...args,
        confirm: true,
        ...(opts.reason ? { reason: opts.reason } : {}),
      },
    },
  }

  const resp = await fetch(`${API_BASE_URL.replace(/\/$/, "")}/admin/mcp`, {
    method: "POST",
    credentials: "include",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    body: JSON.stringify(body),
  })

  const text = await resp.text()
  const rpc = parseRpcBody(text)
  if (rpc?.error) {
    return { ok: false, tool: name, error: rpc.error?.message || "MCP error" }
  }
  // tools/call result: { content: [{ type: "text", text: "<AdminToolResult JSON>" }] }
  const inner = rpc?.result?.content?.[0]?.text
  if (typeof inner === "string") {
    try {
      return JSON.parse(inner) as AdminToolResult
    } catch {
      return { ok: false, tool: name, error: "Could not parse tool result" }
    }
  }
  return { ok: false, tool: name, error: "Empty MCP response" }
}
