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
import {
  convertToModelMessages,
  pipeUIMessageStreamToResponse,
  streamText,
  stepCountIs,
} from "ai"
import {
  buildStorefrontChatSystem,
  resolveStorefrontChatModel,
} from "../../../../mastra/agents/storefront-chat"
import {
  buildDesignChatSystem,
  type DesignChatContext,
} from "../../../../mastra/agents/storefront-design-chat"
import {
  createListRawMaterialsTool,
  createListPartnersTool,
  createAnalyzeProductImageTool,
} from "../../../../mastra/agents/tools/storefront-design-catalog"
import {
  createSaveBriefTool,
  createCreateDesignTool,
  createGenerateDesignImageTool,
  createSetActiveCanvasTool,
  createGetDesignStateTool,
  type DesignContext,
} from "../../../../mastra/agents/tools/storefront-design-flow"
import { createSaveMoodboardTool } from "../../../../mastra/agents/tools/storefront-design-moodboard"
import {
  createAddReferenceLinkTool,
  createListMyDesignsTool,
  createStartNewDesignTool,
  createSwitchDesignTool,
  MAX_DESIGNS_PER_CONVERSATION,
  summarizeDesign,
} from "../../../../mastra/agents/tools/storefront-design-multi"
import { routeDesignTurn, serverActionNote, serverActionUIStream } from "./new-piece-lib"
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
import {
  DESIGN_ACCESS_DENIED_CODE,
  DESIGN_ACCESS_DENIED_MESSAGE,
  readDesignCredentials,
  resolveDesignAccess,
} from "../../../../lib/design-access/authorize"
import { clientIpOf } from "../../../../lib/design-access/rate-limits"
import { sessionCustomerEmail } from "../../../../lib/design-access/conversations"

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const logger: any = req.scope.resolve(ContainerRegistrationKeys.LOGGER)
  const body = (req as any).validatedBody as StoreAiChatReq

  // ── Design-editor mode ──
  // When the request carries a design context (the chat runs inside
  // /products/:handle/design or /design), the route server-resolves the
  // referenced product + design (never trusting client prose), switches the
  // agent into designer-guide mode, and binds the design tools. The concierge
  // tools stay bound — makers wander into shopping mid-flow.
  //
  // 🔴 #2543: the context is assembled HERE, not trusted wholesale. The token
  // comes from the storefront; the customer id and IP are server-derived; and
  // a design id the caller cannot prove access to is refused before the
  // design is read into the prompt or any tool is bound to it.
  const designContext: DesignContext | undefined = body.context
    ? {
        product_id: body.context.product_id,
        design_id: body.context.design_id,
        email: body.context.email,
        // Body context (what the storefront's chat transport sends) or the
        // x-design-token header — same token either way.
        design_token:
          body.context.design_token ?? readDesignCredentials(req).token ?? undefined,
        customer_id: readDesignCredentials(req).customerId ?? undefined,
        client_ip: clientIpOf(req),
      }
    : undefined

  if (designContext?.design_id) {
    const grant = await resolveDesignAccess(req.scope as any, designContext.design_id, {
      token: designContext.design_token,
      customerId: designContext.customer_id,
    })
    if (!grant) {
      res.status(403).json({
        code: DESIGN_ACCESS_DENIED_CODE,
        message: DESIGN_ACCESS_DENIED_MESSAGE,
      })
      return
    }
  }

  // The conversation's other designs: keep the ones this caller can prove,
  // drop the rest. A stale token for one old tab must not refuse the turn —
  // only the ACTIVE design is a hard gate (above).
  if (designContext && body.context?.designs?.length) {
    const seen = new Set<string>(designContext.design_id ? [designContext.design_id] : [])
    const kept: NonNullable<DesignContext["designs"]> = []
    for (const d of body.context.designs) {
      if (seen.has(d.design_id) || kept.length >= MAX_DESIGNS_PER_CONVERSATION - 1) continue
      seen.add(d.design_id)
      const grant = await resolveDesignAccess(req.scope as any, d.design_id, {
        token: d.design_token,
        customerId: designContext.customer_id,
      })
      if (grant) kept.push({ design_id: d.design_id, design_token: d.design_token })
    }
    designContext.designs = kept
  }

  const resolved = await resolveStorefrontChatModel(req.scope as any)
  if (!resolved) {
    res.status(503).json({
      error:
        "AI chat is not configured. Add a platform with role ai_search_chat in Settings → External Platforms, or set DASHSCOPE_API_KEY.",
    })
    return
  }

  // #2556: when the maker clearly asks for another piece (or pressed "+ Another
  // design"), start it HERE, before the model runs. Left to the model, it
  // wrote "Design created ✅" with a made-up id instead of calling
  // start_new_design (prod, 2026-11-19). The result is streamed to the page as
  // an ordinary start_new_design tool part, so the tab appears the usual way.
  const serverAction = designContext
    ? await routeDesignTurn(req.scope as any, designContext, body)
    : null

  const baseSystem = designContext
    ? await buildDesignChatSystemResolved(
        req.scope as any,
        body.prefs,
        designContext,
        body.messages
      )
    : buildStorefrontChatSystem(body.prefs)
  const system = serverAction
    ? `${baseSystem}\n\n${serverActionNote(serverAction)}`
    : baseSystem

  const tools = {
    search_products: createSearchProductsTool(req.scope as any),
    get_categories: createGetCategoriesTool(req.scope as any),
    get_category_products: createGetCategoryProductsTool(req.scope as any),
    get_product_details: createGetProductDetailsTool(req.scope as any),
    capture_contact: createCaptureContactTool(req.scope as any, body.visitor_id),
    ...(designContext
      ? {
          list_raw_materials: createListRawMaterialsTool(req.scope as any),
          list_partners: createListPartnersTool(req.scope as any),
          analyze_product_image: createAnalyzeProductImageTool(req.scope as any),
          save_brief: createSaveBriefTool(),
          create_design: createCreateDesignTool(req.scope as any, designContext),
          generate_design_image: createGenerateDesignImageTool(
            req.scope as any,
            designContext
          ),
          set_active_canvas: createSetActiveCanvasTool(
            req.scope as any,
            designContext
          ),
          get_design_state: createGetDesignStateTool(
            req.scope as any,
            designContext
          ),
          save_moodboard: createSaveMoodboardTool(
            req.scope as any,
            designContext
          ),
          // Already started this turn: offering it again invites a duplicate.
          ...(serverAction
            ? {}
            : {
                start_new_design: createStartNewDesignTool(req.scope as any, designContext),
                switch_design: createSwitchDesignTool(req.scope as any, designContext),
              }),
          list_my_designs: createListMyDesignsTool(req.scope as any, designContext),
          add_reference_link: createAddReferenceLinkTool(req.scope as any, designContext),
        }
      : {}),
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
      // Keep a ceiling above any normal chat reply (kimi-k2.6, the chat
      // model, is non-reasoning — probed: proper arrays in tool args,
      // chained save_brief + capture_contact in one step, 833 tokens).
      maxOutputTokens: 4096,
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
  //
  // `onError` here is NOT the same hook as `streamText`'s above. That one is
  // observability only — it logs and swallows, and the client is left reading
  // a stream that simply stops. This one decides what the CLIENT is told, so
  // a mid-turn failure arrives as an `error` part instead of a clean EOF the
  // browser cannot tell apart from success (#1725). The status line is
  // already committed by the time anything can go wrong, so an error part is
  // the only channel left.
  const onStreamError = (err: unknown) => {
    logAiUsage(logger, {
      feature: "store/ai/chat",
      role: "ai_search_chat",
      provider: usage.providerType,
      source: usage.source,
      platformId: usage.platformId,
      model: usage.modelId,
      ok: false,
      ms: Date.now() - startedAt,
      error: err,
    })
    // Deliberately generic: this reaches a shopper. The provider's own
    // message is in the log line above.
    return "The design assistant's connection dropped mid-turn. Please send that message again."
  }

  if (!serverAction) {
    result.pipeUIMessageStreamToResponse(res as any, { onError: onStreamError } as any)
    return
  }

  // The design the route started goes out FIRST, as a finished
  // start_new_design step, then the model's reply. The page treats it exactly
  // like the model calling the tool: a new tab, made active.
  const stream = serverActionUIStream(result, serverAction, onStreamError)
  pipeUIMessageStreamToResponse({ response: res as any, stream })
}

// ── Server-resolved design context for the system prompt ───────────────

import type { MedusaContainer } from "@medusajs/framework"

/**
 * Server-resolve the product + design referenced by the design context and
 * build the designer-guide prompt. Only server data enters the prompt — a
 * client never gets to inject prose into the system message.
 */
const buildDesignChatSystemResolved = async (
  container: MedusaContainer,
  prefs: StoreAiChatReq["prefs"],
  context: DesignContext,
  messages?: StoreAiChatReq["messages"]
): Promise<string> => {
  // #2543 phase 2: the prompt's email is the SIGNED-IN customer's, read from
  // the session server-side. A client-sent `context.email` is a typed address
  // nobody verified, so it never reaches the prompt as "where designs save".
  const sessionEmail = await sessionCustomerEmail(container, context.customer_id)
  const promptContext: DesignChatContext = {
    product_id: context.product_id,
    design_id: context.design_id,
    signed_in: Boolean(context.customer_id),
    email: sessionEmail ?? undefined,
  }

  if (context.product_id) {
    const query = container.resolve(ContainerRegistrationKeys.QUERY)
    const { data } = await query.graph({
      entity: "product",
      filters: { id: context.product_id },
      fields: ["id", "title", "description", "thumbnail", "images.url"],
    } as any)
    const product: any = data?.[0]
    if (product) {
      promptContext.product = {
        title: product.title,
        description: product.description ?? undefined,
        thumbnail: product.thumbnail ?? undefined,
        images: (product.images || []).map((i: any) => i?.url).filter(Boolean),
      }
    }
  }

  if (context.design_id) {
    const designService: any = container.resolve("design" as any)
    const design = await designService
      .retrieveDesign(context.design_id)
      .catch(() => null)
    if (design) {
      promptContext.design = {
        name: design.name,
        status: design.status,
        product_type: design.product_type ?? null,
        concept_theme: design.concept_theme ?? null,
        aesthetic_keywords: Array.isArray(design.aesthetic_keywords)
          ? design.aesthetic_keywords
          : [],
        // Palette entries are stored as `{ name, code }` — the prompt wants
        // the names. A settled fact the model could not see is a question the
        // maker gets asked twice.
        color_palette: Array.isArray(design.color_palette)
          ? design.color_palette
              .map((c: any) =>
                typeof c === "string" ? c : (c?.name ?? c?.code ?? null)
              )
              .filter((c: any): c is string => typeof c === "string" && !!c)
          : [],
        thumbnail_url: design.thumbnail_url ?? undefined,
      }

      // Moodboard summary — canvas takes + reference analyses — so the agent
      // is grounded on the board every turn without an extra tool round-trip.
      const {
        normalizeCanvasScene,
        readActiveCanvas,
        readCanvasElements,
      } = await import("../../../../modules/designs/lib/canvas-scene.js")
      const scene = normalizeCanvasScene(design.moodboard)
      const active = readActiveCanvas(scene)
      const inspirations = scene.elements
        .filter((el: any) => el.customData?.source === "inspiration")
        .slice(0, 8)
        .map((el: any) => {
          const a = el.customData?.analysis as
            | { title?: string; description?: string }
            | undefined
          return {
            title: a?.title ?? null,
            description: a?.description ?? null,
          }
        })
      promptContext.design.board = {
        canvas_count: readCanvasElements(scene).length,
        active_canvas: active?.customData?.canvas
          ? {
              letter: active.customData.canvas.letter ?? null,
              kind: active.customData.canvas.kind,
              prompt_used: active.customData.canvas.prompt_used,
            }
          : null,
        inspirations,
      }
    }
  }

  // Every design this conversation holds, so the model knows which piece is
  // which and can switch by name. The active one is marked.
  const otherIds = (context.designs ?? []).map((d) => d.design_id)
  if (otherIds.length) {
    const designService: any = container.resolve("design" as any)
    const rows: any[] = await designService
      .listDesigns({ id: [context.design_id, ...otherIds].filter(Boolean) }, { take: 20 })
      .catch(() => [])
    const byId = new Map(rows.map((r) => [r.id, r]))
    promptContext.designs = [context.design_id, ...otherIds]
      .filter((id): id is string => !!id && byId.has(id))
      .map((id) => summarizeDesign(byId.get(id), id === context.design_id))
  }

  return buildDesignChatSystem(prefs, promptContext, messages)
}
