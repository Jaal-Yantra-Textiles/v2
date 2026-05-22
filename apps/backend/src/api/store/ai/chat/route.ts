/**
 * POST /store/ai/chat
 *
 * Streaming chat endpoint for the storefront concierge modal.
 *
 * Pipeline:
 *   1. Validate body (via middlewares.ts → StoreAiChatSchema).
 *   2. Resolve the chat model — DB-configured platform for role
 *      `ai_search_chat` first, then DashScope / Cloudflare / OpenRouter
 *      env fallbacks. See `mastra/agents/storefront-chat.ts`.
 *   3. Build the system prompt with the customer's onboarding prefs +
 *      brand-knowledge corpus injected.
 *   4. Bind the `search_products` tool to this request's container so
 *      the model can look up real products mid-conversation.
 *   5. `streamText(...)` and pipe the AI-SDK UI message stream straight
 *      into the Express response. The storefront consumes this via
 *      `useChat` / a hand-rolled reader.
 *
 * Public (no customer auth) — matches `/store/ai/search`. Visitor id is
 * required in the body so future analytics/persistence work can join
 * threads with cart + events.
 *
 * Why not `Agent.stream()` from Mastra? — we need per-request
 * parameterisation (prefs, container-bound tool) and the direct AI-SDK
 * path is shorter and matches `extract.ts`'s style for the
 * non-streaming search route.
 */
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { convertToModelMessages, streamText, stepCountIs } from "ai"
import {
  buildStorefrontChatSystem,
  resolveStorefrontChatModel,
} from "../../../../mastra/agents/storefront-chat"
import { createSearchProductsTool } from "../../../../mastra/agents/tools/storefront-search-products"
import type { StoreAiChatReq } from "./validators"

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const body = (req as any).validatedBody as StoreAiChatReq

  const resolved = await resolveStorefrontChatModel(req.scope as any)
  if (!resolved) {
    res.status(503).json({
      error:
        "AI chat is not configured. Add a platform with role ai_search_chat in Settings → External Platforms, or set DASHSCOPE_API_KEY.",
    })
    return
  }

  const system = buildStorefrontChatSystem(body.prefs)
  const tools = {
    search_products: createSearchProductsTool(req.scope as any),
  }

  // Normalise the inbound UI messages. The AI-SDK v5 client posts
  // {role, parts:[{type:"text",text}]}; older clients may post
  // {role, content:"..."}. Coerce both into the parts shape so
  // convertToModelMessages produces clean ModelMessages.
  const messages = body.messages.map((m: any) => {
    if (Array.isArray(m.parts) && m.parts.length) {
      return { id: m.id, role: m.role, parts: m.parts }
    }
    return {
      id: m.id,
      role: m.role,
      parts: [{ type: "text", text: String(m.content ?? "") }],
    }
  })

  let result
  try {
    result = streamText({
      model: resolved.model,
      system,
      messages: convertToModelMessages(messages as any),
      tools,
      // Allow at most one round-trip of tool-call → tool-result →
      // model reply per turn. Higher counts let the model spin on
      // tool calls; one is enough for "search and summarise".
      stopWhen: stepCountIs(3),
      temperature: 0.6,
      onError: (err) => {
        console.warn(
          `[store/ai/chat] streamText error (${resolved.provider}):`,
          (err as any)?.error?.message ?? err
        )
      },
    })
  } catch (e: any) {
    console.warn(
      `[store/ai/chat] streamText threw (${resolved.provider}):`,
      e?.message ?? e
    )
    res.status(502).json({ error: "chat provider failed" })
    return
  }

  // Pipe the AI-SDK UI-message stream into the Express response.
  // The SDK handles SSE framing, Content-Type, and flushes — we just
  // hand it the Node ServerResponse Medusa hands us.
  result.pipeUIMessageStreamToResponse(res as any)
}
