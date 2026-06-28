/**
 * Provider-aware placement of the chat system prompt.
 *
 * Why this exists:
 *   `@ai-sdk/openai` (used for every OpenAI-compatible provider — DashScope,
 *   Cloudflare, Vercel AI Gateway, custom) decides how to emit the system
 *   message from the model id alone:
 *
 *     isReasoningModel = !(id.startsWith("gpt-3"|"gpt-4"|"chatgpt-4o"|"gpt-5-chat"))
 *     systemMessageMode = isReasoningModel ? "developer" : "system"
 *
 *   So ANY non-GPT id (e.g. DashScope's `qwen-plus`) is treated as a
 *   "reasoning model" and the system prompt is sent with role `developer`.
 *   DashScope's API rejects it:
 *     "developer is not one of ['system','assistant','user','tool','function']
 *      - 'messages.[0].role'"
 *   — which surfaces to the shopper as "Something went wrong. Try again."
 *
 *   There's no per-call override for `systemMessageMode` in the pinned
 *   `@ai-sdk/openai` (v2, spec v2). The fix mirrors `buildGenerateArgs` in
 *   `mastra/services/ai-platforms.ts`: keep the native `system` param for
 *   OpenRouter (which accepts the role), and for everything else fold the
 *   system text into the first user message so no `system`/`developer` role
 *   is ever emitted. Folding into a user message is accepted everywhere.
 *
 * Pure — no container, no SDK. Unit-tested.
 */

export type ChatTextPart = { type: string; text: string }
export type ChatUiMessage = { role: string; parts: ChatTextPart[] }

export type FoldedChatInput = {
  /** Pass to streamText({ system }) only when present (OpenRouter). */
  system?: string
  /** The (possibly rewritten) UI messages to convert + stream. */
  messages: ChatUiMessage[]
}

/**
 * Decide where the system prompt goes for the resolved provider.
 *
 * @param provider  the `resolved.provider` string, e.g. `db:dashscope:01..`,
 *                  `dashscope:qwen-plus`, `db:openrouter:01..`, `openrouter:free`.
 * @param system    the built system prompt.
 * @param messages  normalised UI messages (text-only parts).
 */
export const foldSystemForProvider = (
  provider: string,
  system: string,
  messages: ChatUiMessage[]
): FoldedChatInput => {
  // OpenRouter accepts the AI-SDK `system` role natively — leave it alone.
  if (provider.includes("openrouter")) {
    return { system, messages }
  }

  const sys = (system || "").trim()
  if (!sys) return { messages }

  // Deep-copy so callers' arrays/parts aren't mutated.
  const out: ChatUiMessage[] = messages.map((m) => ({
    role: m.role,
    parts: m.parts.map((p) => ({ ...p })),
  }))

  const firstUser = out.find((m) => m.role === "user")
  if (!firstUser) {
    // No user turn (shouldn't happen — validator requires ≥1 message) — add one.
    out.unshift({ role: "user", parts: [{ type: "text", text: sys }] })
    return { messages: out }
  }

  const firstText = firstUser.parts.find((p) => p.type === "text")
  if (firstText) {
    firstText.text = firstText.text ? `${sys}\n\n${firstText.text}` : sys
  } else {
    firstUser.parts.unshift({ type: "text", text: sys })
  }
  return { messages: out }
}
