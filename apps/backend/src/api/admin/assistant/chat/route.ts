/**
 * POST /admin/assistant/chat
 *
 * Streaming chat endpoint for the admin assistant. The model drives the Admin
 * API through the shared MCP tool registry (see ../../mcp/lib/registry) with
 * three safety rails from the shared dispatcher:
 *
 *   - `dry_run` on any tool previews the request (and current object for writes)
 *     without executing, so the model can inspect live data first.
 *   - sensitive/destructive tools return `requires_confirmation` instead of
 *     running; the UI surfaces an approval card and, on confirm, calls
 *     POST /admin/mcp directly with `confirm: true`.
 *   - dangerous (platform-destructive) tools additionally return
 *     `requires_reason`; the admin must supply a reason (audited).
 *
 * Pipeline mirrors the partner assistant: resolve the chat model for the
 * `ai_admin_assistant` role (DB-configured platform → OpenRouter free
 * fallback), bind tools, `streamText(...)`, and pipe the UI message stream into
 * the response. All /admin/* routes are admin-user authenticated by Medusa.
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
import { ADMIN_MCP_TOOLS, renderToolGuidance } from "../../mcp/lib/registry"
import {
  dispatchAdminTool,
  buildToolInputSchema,
  isSensitive,
  isDangerous,
  type AdminMcpContext,
} from "../../mcp/lib/dispatch"
import {
  isAdminWriteEnabled,
  isAdminDangerousEnabled,
  resolveAdminBaseUrl,
} from "../../mcp/lib/handler"
import type { AdminAssistantChatReq } from "./validators"

const FEATURE = "admin/assistant/chat"
const ROLE = "ai_admin_assistant"

const SYSTEM_PROMPT = `You are the JYT admin assistant. You help platform operators run the business by calling Admin API tools on their behalf — reading orders, products, customers, partners, stores, designs, production runs, inventory, payments and campaigns, and (in later tiers) acting on them.

## How to work
- ALWAYS call \`get_admin_stats\` first to ground yourself in the platform's current shape before answering operational questions.
- Use the read tools (list_orders, list_products, list_customers, list_partners, list_designs, list_production_runs, list_inventory_items, list_payments, ...) to answer "what's happening" questions. Fetch a single record with the get_* tools when you have an id.
- Prefer doing (calling a tool) over describing. Chain tools to complete a goal, and set each tool's \`context\` to what you're ultimately trying to accomplish.

## Safety rails (important)
- Every tool accepts \`dry_run: true\`. Use it to PREVIEW a change and inspect the current object before you actually write.
- Sensitive/destructive tools refuse to run unless the user confirms. Never set \`confirm: true\` yourself. If a tool returns \`requires_confirmation\`, tell the user plainly what it will do and ask them to approve — the UI gives them a button.
- Platform-destructive ("dangerous") tools additionally require a \`reason\`. If a tool returns \`requires_reason\`, ask the operator WHY they want to do it and pass their answer as the reason. Never invent a reason.

## Style
- Be concise and operator-focused. After a successful change, confirm what you did in one short sentence.
- Never invent ids, values, or fields outside the tool schemas.`

export const POST = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const logger: any = req.scope.resolve(ContainerRegistrationKeys.LOGGER)
  const body = (req as any).validatedBody as AdminAssistantChatReq

  const resolved = await resolveRoleTextModel(req.scope as any, ROLE)
  if (resolved.source === "free" && !process.env.OPENROUTER_API_KEY) {
    res.status(503).json({
      error:
        "The admin assistant is not configured. Add a platform with role ai_admin_assistant in Settings → External Platforms, or set OPENROUTER_API_KEY.",
    })
    return
  }

  // Loopback context — forward the admin's auth so wrapped routes authenticate
  // as the admin user. Writes/dangerous still require confirmation (+ reason)
  // via the shared dispatcher; the write/dangerous flags gate visibility.
  const ctx: AdminMcpContext = {
    baseUrl: resolveAdminBaseUrl(req),
    bearer: req.get("authorization") || undefined,
    cookie: req.get("cookie") || undefined,
    enableWrite: isAdminWriteEnabled(),
    enableDangerous: isAdminDangerousEnabled(),
    surface: "admin",
  }
  const writeEnabled = ctx.enableWrite !== false
  const dangerousEnabled = ctx.enableDangerous === true

  // Bind the registry as AI-SDK tools. One source of truth (JSON Schema) feeds
  // both this binding and the MCP endpoint's tools/list. Disabled tiers are
  // hidden from the model entirely (and refused at dispatch as a backstop).
  const tools = Object.fromEntries(
    ADMIN_MCP_TOOLS.filter(
      (def) =>
        (writeEnabled || !def.write) &&
        (dangerousEnabled || !isDangerous(def))
    ).map((def) => [
      def.name,
      tool({
        description:
          def.description +
          (isDangerous(def)
            ? " [dangerous: requires user confirmation AND a reason]"
            : isSensitive(def)
            ? " [sensitive: requires user confirmation]"
            : "") +
          renderToolGuidance(def),
        inputSchema: jsonSchema(buildToolInputSchema(def)),
        execute: async (input: any) => dispatchAdminTool(ctx, def.name, input),
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
  // length and can land on a text-only model, so on the free path use the
  // tool-capable variant. A DB-configured platform for this role overrides this.
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
        await new Promise((r) => setTimeout(r, 400 * attempt))
        continue
      }
      res.status(502).json({ error: "admin assistant provider failed" })
      return
    }
  }

  result.pipeUIMessageStreamToResponse(res as any)
}
