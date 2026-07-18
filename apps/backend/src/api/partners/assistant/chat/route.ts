/**
 * POST /partners/assistant/chat
 *
 * Streaming chat endpoint for the partner-portal assistant. The model drives
 * the Partner API through the declarative tool registry (see
 * ../../mcp/lib/registry) — onboarding, persona, UI layout, and reads across
 * orders/products/stores/designs/inventory — with two safety rails:
 *
 *   - `dry_run` on any tool previews the request (and current object for
 *     writes) without executing, so the model can inspect live data first.
 *   - sensitive/destructive tools return `requires_confirmation` instead of
 *     running; the frontend surfaces an approval card and, on confirm, calls
 *     POST /partners/mcp directly with `confirm: true`.
 *
 * Pipeline mirrors the theme-editor chat (#339): resolve the chat model for the
 * `ai_partner_assistant` role (DB-configured platform → OpenRouter free
 * fallback), bind tools, `streamText(...)`, and pipe the UI message stream into
 * the response. Authenticated as a partner route.
 */
import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import {
  convertToModelMessages,
  streamText,
  stepCountIs,
  tool,
  jsonSchema,
} from "ai"
import { resolveRoleTextModel, logAiUsage } from "../../../../mastra/services/ai-platforms"
import { dynamicFreeToolTextModel } from "../../../../mastra/providers/dynamic-text-model"
import { foldSystemForProvider } from "../../../store/ai/chat/system-fold-lib"
import { PARTNER_MCP_TOOLS, renderToolGuidance } from "../../mcp/lib/registry"
import {
  dispatchPartnerTool,
  buildToolInputSchema,
  isSensitive,
  type PartnerMcpContext,
} from "../../mcp/lib/dispatch"
import {
  isPartnerWriteEnabled,
  resolvePartnerBaseUrl,
} from "../../mcp/lib/handler"
import type { PartnerAssistantChatReq } from "./validators"

const FEATURE = "partners/assistant/chat"
const ROLE = "ai_partner_assistant"

const SYSTEM_PROMPT = `You are the JYT partner-portal assistant. You help partners (sellers, manufacturers, individual makers, and designers) set up and run their workspace by calling Partner API tools on their behalf.

## How to work
- ALWAYS call \`get_partner_profile\` first to learn the partner's name, persona (workspace_type), and how far onboarding has progressed. Then help with what they asked.
- For ONBOARDING: guide the partner conversationally. The essential gate is a business name + a persona (workspace_type: 'seller' | 'manufacturer' | 'individual' | 'designer'). Set those with \`update_partner_profile\`, and when both are set, merge \`metadata.onboarding_essentials_done = true\` into their existing metadata (read it from get_partner_profile first — metadata is REPLACED, not patched, so always spread the existing values). Record deeper answers (what they sell, team size, selling mode, etc.) with \`update_onboarding_profile\`.
- For LAYOUT personalization: use the layout tools to reorder or hide sidebar/home widgets for zones 'sidebar.main' and 'home'.
- To answer questions about their business, use the read tools (list_orders, list_products, list_stores, list_designs, list_inventory_items, list_notifications).

## Safety rails (important)
- Every tool accepts \`dry_run: true\`. Use it to PREVIEW a change and inspect the current object before you actually write — especially before any update. Show the user what will change, then run the tool for real.
- Sensitive/destructive tools (deletes, resets) will refuse to run unless the user confirms. Never set \`confirm: true\` yourself. If a tool returns \`requires_confirmation\`, tell the user plainly what it will do and ask them to confirm — the UI gives them an approve button.

## Style
- Be concise and action-oriented. Prefer doing (calling a tool) over describing.
- After a successful change, confirm what you did in one short sentence.
- Never invent ids, values, or fields outside the tool schemas.`

export const POST = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const logger: any = req.scope.resolve(ContainerRegistrationKeys.LOGGER)
  const body = (req as any).validatedBody as PartnerAssistantChatReq

  const resolved = await resolveRoleTextModel(req.scope as any, ROLE)
  if (resolved.source === "free" && !process.env.OPENROUTER_API_KEY) {
    res.status(503).json({
      error:
        "The partner assistant is not configured. Add a platform with role ai_partner_assistant in Settings → External Platforms, or set OPENROUTER_API_KEY.",
    })
    return
  }

  // Loopback context — forward the partner's auth so wrapped routes scope to
  // this partner. Sensitive writes still require confirmation via the MCP route.
  const ctx: PartnerMcpContext = {
    baseUrl: resolvePartnerBaseUrl(req),
    bearer: req.get("authorization") || undefined,
    cookie: req.get("cookie") || undefined,
    enableWrite: isPartnerWriteEnabled(),
  }
  const writeEnabled = ctx.enableWrite !== false

  // Bind the registry as AI-SDK tools. One source of truth (JSON Schema) feeds
  // both this binding and the MCP endpoint's tools/list.
  const tools = Object.fromEntries(
    PARTNER_MCP_TOOLS.filter((def) => writeEnabled || !def.write).map((def) => [
      def.name,
      tool({
        description:
          def.description +
          (isSensitive(def) ? " [sensitive: requires user confirmation]" : "") +
          renderToolGuidance(def),
        inputSchema: jsonSchema(buildToolInputSchema(def)),
        execute: async (input: any) => dispatchPartnerTool(ctx, def.name, input),
      }),
    ])
  )

  // Normalise inbound UI messages — strip tool parts from history.
  const messages = body.messages.map((m: any) => {
    const parts = Array.isArray(m.parts) ? m.parts : null
    const textParts = parts
      ? parts
          .filter(
            (p: any) =>
              p?.type === "text" && typeof p.text === "string" && p.text.length > 0
          )
          .map((p: any) => ({ type: "text", text: p.text }))
      : [{ type: "text", text: String(m.content ?? "") }]

    return {
      role: m.role,
      parts: textParts.length ? textParts : [{ type: "text", text: "" }],
    }
  })

  // This assistant REQUIRES tool calling. The free rotator ranks by context
  // length and can land on a text-only model ("No endpoints found that support
  // tool use"), so on the free path use the tool-capable variant (openrouter/
  // free). A DB-configured platform for this role overrides this entirely.
  const chatModel =
    resolved.source === "free" ? dynamicFreeToolTextModel : resolved.model

  const folded = foldSystemForProvider(resolved.providerType, SYSTEM_PROMPT, messages)
  const startedAt = Date.now()

  const usageBase = {
    feature: FEATURE,
    role: ROLE,
    provider: resolved.providerType,
    source: resolved.source,
    platformId: resolved.platformId,
    model: resolved.modelId,
  } as const

  let result
  const MAX_CONSTRUCTION_ATTEMPTS = 2
  for (let attempt = 1; attempt <= MAX_CONSTRUCTION_ATTEMPTS; attempt++) {
    try {
      result = streamText({
        model: chatModel,
        ...(folded.system ? { system: folded.system } : {}),
        messages: convertToModelMessages(folded.messages as any),
        tools,
        stopWhen: stepCountIs(8),
        temperature: 0.3,
        // Let the AI SDK retry transient network/5xx failures at the model
        // layer. The free rotator separately self-heals free-tier expiry
        // (dynamic-text-model.ts), so this covers non-free providers and
        // generic upstream hiccups.
        maxRetries: 3,
        onFinish: ({ usage: u }: any) => {
          logAiUsage(logger, {
            ...usageBase,
            ok: true,
            ms: Date.now() - startedAt,
            tokens: u?.totalTokens,
          })
        },
        onError: (err: any) => {
          logAiUsage(logger, {
            ...usageBase,
            ok: false,
            ms: Date.now() - startedAt,
            error: err?.error ?? err,
          })
        },
      })
      break
    } catch (e: any) {
      logAiUsage(logger, {
        ...usageBase,
        ok: false,
        ms: Date.now() - startedAt,
        error: e,
      })
      if (attempt < MAX_CONSTRUCTION_ATTEMPTS) {
        // Back off briefly and retry construction once — transient provider
        // resolution / connection errors often clear on a second attempt.
        await new Promise((r) => setTimeout(r, 400 * attempt))
        continue
      }
      res.status(502).json({ error: "partner assistant provider failed" })
      return
    }
  }

  result.pipeUIMessageStreamToResponse(res as any)
}
