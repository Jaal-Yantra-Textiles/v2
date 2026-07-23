/**
 * Partner MCP confirm bridge (#338 item 2).
 *
 * The assistant's sensitive/destructive tools never auto-execute — the chat
 * endpoint returns `requires_confirmation` and the UI shows an approval card.
 * On approve we call the Partner MCP JSON-RPC endpoint DIRECTLY (bypassing the
 * model) with `confirm: true`, re-issuing the exact tool + arguments the model
 * proposed. This is the single sanctioned path for running a sensitive tool.
 *
 * The endpoint runs stateless Streamable HTTP with `enableJsonResponse`, so a
 * single POST returns a plain JSON-RPC body (it may also arrive as an SSE
 * `data:` frame — we parse both).
 */
import { sdk, backendUrl } from "./client"

const jwtTokenStorageKey = __JWT_TOKEN_STORAGE_KEY__ || "partner_ui_auth_token"

/** Mirrors the backend PartnerToolResult (dispatch.ts). */
export type PartnerToolResult = {
  ok: boolean
  tool: string
  data?: unknown
  error?: string
  requires_confirmation?: boolean
  plan?: Record<string, unknown>
  current?: unknown
  warning?: string
}

function authToken(): string | null {
  return (
    (sdk as any).client?.token ||
    (typeof window !== "undefined"
      ? localStorage.getItem(jwtTokenStorageKey)
      : null)
  )
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
 * Execute a partner tool via the MCP endpoint. `args` should be the arguments
 * the model proposed; `confirm: true` is added here for the sensitive gate.
 */
export async function runPartnerMcpTool(
  name: string,
  args: Record<string, unknown>
): Promise<PartnerToolResult> {
  const token = authToken()
  const res = await fetch(
    `${backendUrl.replace(/\/$/, "")}/partners/mcp`,
    {
      method: "POST",
      credentials: "include",
      headers: {
        "content-type": "application/json",
        // Streamable HTTP requires the client to accept both.
        accept: "application/json, text/event-stream",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name, arguments: { ...args, confirm: true } },
      }),
    }
  )

  if (!res.ok) {
    throw new Error(`MCP call failed: HTTP ${res.status}`)
  }

  const rpc = parseRpcBody(await res.text())
  if (rpc?.error) {
    throw new Error(rpc.error?.message || "MCP JSON-RPC error")
  }

  // tools/call result → { content: [{ type: "text", text: "<json>" }], isError? }
  const textPart = rpc?.result?.content?.find?.((c: any) => c?.type === "text")
  if (!textPart?.text) {
    throw new Error("MCP tool returned no content")
  }
  return JSON.parse(textPart.text) as PartnerToolResult
}
