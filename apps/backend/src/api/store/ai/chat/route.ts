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
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { convertToModelMessages, streamText, stepCountIs } from "ai"
import {
  buildStorefrontChatSystem,
  resolveStorefrontChatModel,
} from "../../../../mastra/agents/storefront-chat"
import { createSearchProductsTool } from "../../../../mastra/agents/tools/storefront-search-products"
import {
  createGetCategoriesTool,
  createGetCategoryProductsTool,
  createGetProductDetailsTool,
} from "../../../../mastra/agents/tools/storefront-catalog-tools"
import { createCaptureContactTool } from "../../../../mastra/agents/tools/storefront-capture-contact"
import { foldSystemForProvider } from "./system-fold-lib"
import { parseChatProvider } from "./chat-usage-lib"
import { logAiUsage } from "../../../../mastra/services/ai-platforms"
import type { StoreAiChatReq } from "./validators"

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const logger: any = req.scope.resolve(ContainerRegistrationKeys.LOGGER)
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
    get_categories: createGetCategoriesTool(req.scope as any),
    get_category_products: createGetCategoryProductsTool(req.scope as any),
    get_product_details: createGetProductDetailsTool(req.scope as any),
    capture_contact: createCaptureContactTool(req.scope as any, body.visitor_id),
  }

  // Normalise the inbound UI messages.
  //
  // The AI-SDK v5 client posts {id, role, parts:[{type:"text",text}, …,
  // {type:"tool-search_products", state, input, output, toolCallId, …}]}.
  // Older clients may post {role, content:"..."}.
  //
  // Two things to strip before `convertToModelMessages`:
  //
  //   1. `id` on each message — UI-only field. Some OpenAI-compatible
  //      shims (DashScope, Cloudflare) bubble it into the upstream
  //      payload and reject with "invalid request: unrecognised fields,
  //      id". The model doesn't need it.
  //
  //   2. Tool parts from prior turns. The client serialises them with
  //      the full SDK shape (state machine, tool-call ids, inputs,
  //      outputs). When `convertToModelMessages` rebuilds the ModelMessage
  //      from these it can produce assistant/tool message pairs whose
  //      tool_call_id format the provider doesn't accept — same
  //      "unrecognised field" error, different keys. Pruning tool parts
  //      from history is lossy (the model can't remember it searched
  //      already and may re-call the tool) but keeps the request shape
  //      clean. Phase 2 will move thread state server-side and let us
  //      serialise tool calls in a canonical shape.
  const messages = body.messages.map((m: any) => {
    const parts = Array.isArray(m.parts) ? m.parts : null
    const textParts = parts
      ? parts
          .filter((p: any) => p?.type === "text" && typeof p.text === "string" && p.text.length > 0)
          .map((p: any) => ({ type: "text", text: p.text }))
      : [{ type: "text", text: String(m.content ?? "") }]

    return {
      role: m.role,
      parts: textParts.length
        ? textParts
        : [{ type: "text", text: "" }],
    }
  })

  // Place the system prompt where the resolved provider accepts it. For
  // OpenAI-compatible endpoints (DashScope/Cloudflare/…), @ai-sdk/openai emits
  // the system message with role `developer` for any non-GPT model id, which
  // DashScope rejects — so we fold it into the first user message instead.
  // Only OpenRouter keeps the native `system` param. See system-fold-lib.ts.
  const folded = foldSystemForProvider(resolved.provider, system, messages)

  // Map the chat resolver's `provider` string into structured [ai-usage] fields
  // so chat emits the same telemetry as every other AI feature.
  const usage = parseChatProvider(resolved.provider)
  const startedAt = Date.now()

  let result
  try {
    result = streamText({
      model: resolved.model,
      ...(folded.system ? { system: folded.system } : {}),
      messages: convertToModelMessages(folded.messages as any),
      tools,
      // Allow a couple of tool round-trips per turn (e.g. get_categories
      // then get_category_products, or search then get_product_details)
      // while still capping runaway tool loops.
      stopWhen: stepCountIs(5),
      temperature: 0.6,
      onFinish: ({ usage: u }: any) => {
        logAiUsage(logger, {
          feature: "store/ai/chat",
          role: "ai_search_chat",
          provider: usage.providerType,
          source: usage.source,
          platformId: usage.platformId,
          model: usage.modelId,
          ok: true,
          ms: Date.now() - startedAt,
          tokens: u?.totalTokens,
        })
      },
      onError: (err) => {
        logAiUsage(logger, {
          feature: "store/ai/chat",
          role: "ai_search_chat",
          provider: usage.providerType,
          source: usage.source,
          platformId: usage.platformId,
          model: usage.modelId,
          ok: false,
          ms: Date.now() - startedAt,
          error: (err as any)?.error ?? err,
        })
      },
    })
  } catch (e: any) {
    logAiUsage(logger, {
      feature: "store/ai/chat",
      role: "ai_search_chat",
      provider: usage.providerType,
      source: usage.source,
      platformId: usage.platformId,
      model: usage.modelId,
      ok: false,
      ms: Date.now() - startedAt,
      error: e,
    })
    res.status(502).json({ error: "chat provider failed" })
    return
  }

  // Pipe the AI-SDK UI-message stream into the Express response.
  // The SDK handles SSE framing, Content-Type, and flushes — we just
  // hand it the Node ServerResponse Medusa hands us.
  result.pipeUIMessageStreamToResponse(res as any)
}
