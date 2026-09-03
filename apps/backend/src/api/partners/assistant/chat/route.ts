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
 * The full registry stays bound (every tool stays callable), but only a
 * per-ask slice is serialised to the provider via `activeTools` + prepareStep
 * (see ../../mcp/lib/tool-slice) — so the ~178-tool registry does not become a
 * per-turn token cost. A `load_partner_tools` escape hatch widens the slice
 * mid-run when the model asks for a domain it wasn't given.
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
  selectPartnerToolSlice,
  toolsInDomains,
  widenedDomainsFromHistory,
  toolDomain,
  SELECTABLE_DOMAINS,
} from "../../mcp/lib/tool-slice"
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
import { makeMcpLedgerSink } from "../../../../lib/mcp-ledger"
import {
  buildSystemPrompt,
  domainSop,
  extractContextFromTurn,
  loadAndFormatContext,
  resolveContextCache,
  buildRunPlanTool,
} from "../../../../lib/assistant-context"
import { getPartnerFromAuthContext } from "../../helpers"
import {
  loadConversationAttachments,
  mergeAttachments,
  renderAttachments,
} from "./attachments"
import {
  formatPartnerIdentityBlock,
  resolvePartnerIdentity,
} from "./identity-context"
import { normaliseUiMessages } from "../../../../lib/assistant-messages"
import type { PartnerAssistantChatReq } from "./validators"

const FEATURE = "partners/assistant/chat"
const ROLE = "ai_partner_assistant"


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
    observe: makeMcpLedgerSink(req.scope, {
      id: (req as any).auth_context?.actor_id ?? null,
      type: "partner",
    }),
  }
  const writeEnabled = ctx.enableWrite !== false

  // Bind the registry as AI-SDK tools. One source of truth (JSON Schema) feeds
  // both this binding and the MCP endpoint's tools/list.
  const enabled = PARTNER_MCP_TOOLS.filter((def) => writeEnabled || !def.write)

  const tools: Record<string, any> = Object.fromEntries(
    enabled.map((def) => [
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

  // Normalise inbound UI messages — strip tool parts from history, then bound
  // what we keep. The route accepts a 5 MB body deliberately (it must be able
  // to RECEIVE replayed tool parts), but nothing used to stop that 5 MB being
  // copied through parse → zod → normalise → convertToModelMessages → fold.
  // See ./normalise for the ceilings and why they sit well above real use.
  const normalised = normaliseUiMessages(body.messages)
  const messages = normalised.messages
  if (normalised.bounded) {
    logger.warn(
      `[${FEATURE}] payload bounded: dropped ${normalised.droppedMessages} old message(s), ` +
        `truncated ${normalised.truncatedParts} part(s). Conversation ${body.id ?? "unknown"}.`
    )
  }

  // ---- Photo context ------------------------------------------------------
  // Recovered from the partner's assistant folder rather than the message
  // history, because history arrives text-only: anything appended to a previous
  // turn is gone by this one, and "upload a few, then build the product" is the
  // whole feature. See ./attachments.
  const partner = await getPartnerFromAuthContext(req.auth_context, req.scope)
  const conversationAttachments = partner
    ? await loadConversationAttachments(req.scope, partner.id, body.id)
    : []
  const attachments = mergeAttachments(
    conversationAttachments,
    (body.attachments ?? []) as any
  )
  if (attachments.length) {
    // Attach to the last USER message — that is the turn the model is answering,
    // and appending to an assistant turn would read as something it once said.
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "user") {
        messages[i].parts.push({
          type: "text",
          text: renderAttachments(attachments),
        })
        break
      }
    }
  }

  // ---- Per-ask registry slicing -------------------------------------------
  // All ~178 tools stay BOUND (so any of them can still execute), but only the
  // slice this ask needs is serialised to the provider via `activeTools`.
  // Without this every turn re-sends the whole registry, which is both the
  // dominant token cost of a conversation and — because the free rotator ranks
  // by context length — a lever on which model answers.
  //
  // `activated` is the live slice. It starts from keyword matching on the recent
  // conversation and can only ever GROW, via load_partner_tools below, so a bad
  // initial guess costs one round trip rather than a capability.
  const recentText = messages
    .slice(-6)
    .map((m: any) => m.parts.map((p: any) => p.text).join(" "))
    .join("\n")

  const initialSlice = selectPartnerToolSlice(recentText, enabled)
  const activated = new Set<string>(initialSlice.names)

  // Carry forward whatever the model widened into earlier in this conversation.
  // Keyword matching runs fresh every request and history arrives text-only, so
  // without this a domain bought with a round trip on the previous turn is gone
  // on this one — and "now do the same for the other one" pays for it twice.
  const carried = widenedDomainsFromHistory(body.messages)
  if (carried.length) {
    toolsInDomains(carried, enabled).forEach((n) => activated.add(n))
  }

  logger.debug?.(
    `[${FEATURE}] tool slice: ${activated.size}/${enabled.length} tools` +
      ` (domains: ${initialSlice.domains.join(", ") || "none matched"}` +
      `${carried.length ? `; carried: ${carried.join(", ")}` : ""})`
  )

  // ---- Prior context injection (cross-conversation cache) -----------------
  // Read the domain-keyed cache for this partner and inject a thin "you
  // already found this" block into the system prompt. Lets the model skip a
  // re-fetch when the partner repeats a task from a previous conversation.
  const partnerId = partner?.id ?? (req as any).auth_context?.actor_id ?? null
  // Resolved defensively: the cache only ever saves a re-fetch, so it must
  // never be able to fail the turn (see lib/assistant-context/resolve).
  const cacheService = partnerId ? resolveContextCache(req.scope, logger) : null
  const activeDomains = initialSlice.domains.filter((d) => d !== "core")
  const priorContext = cacheService
    ? await loadAndFormatContext(
        cacheService,
        partnerId,
        "partner",
        activeDomains
      )
    : undefined

  // ---- Identity context (#1392) -------------------------------------------
  // What the SERVER knows, as opposed to `priorContext` above, which caches
  // what the model once FOUND. The request is already authenticated as this
  // partner, so making the model call `list_stores` to learn which store it is
  // writing to was always a round trip to rediscover the caller — and an
  // unreliable one: a model that forgets to look asks the partner to choose
  // between the single store they own.
  //
  // Recomputed every turn from one query, so unlike a cache it cannot go stale.
  const identity = await resolvePartnerIdentity(req.scope, partnerId, logger)
  const identityBlock = formatPartnerIdentityBlock(identity)

  // The escape hatch. Always active, so the model is never boxed in by a slice
  // that guessed wrong — it names the domains it needs and they light up on the
  // next step. This is also why the slice can be aggressive.
  tools.load_partner_tools = tool({
    description:
      "Load the tools for one or more partner domains when the tool you need is not currently available to you. " +
      `Valid domains: ${SELECTABLE_DOMAINS.join(", ")}. ` +
      "Returns the names and descriptions of the tools that just became callable — call them on your next step. " +
      "Use this instead of telling the user something is impossible.",
    inputSchema: jsonSchema({
      type: "object",
      properties: {
        domains: {
          type: "array",
          items: { type: "string", enum: SELECTABLE_DOMAINS },
          description: "The partner domains to load tools for.",
        },
      },
      required: ["domains"],
      additionalProperties: false,
    }),
    execute: async ({ domains }: { domains: string[] }) => {
      const names = toolsInDomains(domains ?? [], enabled)
      names.forEach((n) => activated.add(n))
      // A domain widened into MID-RUN never got its SOP in the system prompt
      // (that is fixed at streamText start), so deliver it here instead — the
      // model reads it as part of the tool result and applies it next step.
      const guidance = (domains ?? [])
        .map((d) => domainSop("partner", d))
        .filter(Boolean)
        .join("\n\n")
      return {
        ok: true,
        loaded: names.length,
        domains: domains ?? [],
        tools: enabled
          .filter((d) => names.includes(d.name))
          .map((d) => ({
            name: d.name,
            domain: toolDomain(d),
            description: d.description,
          })),
        ...(guidance ? { guidance } : {}),
      }
    },
  })
  activated.add("load_partner_tools")

  // Structured multi-step planning. The model can emit ONE plan instead of
  // chaining tool calls itself; every step still goes through dispatchPartnerTool
  // (dry_run rails + write gating); a plan naming a tool that needs CONFIRMATION
  // is refused whole, before anything runs (#1757). `resolve` steps consult the
  // entity-memory cache so "customer by email" skips the lookup tool.
  const resolveEntity = cacheService && partnerId
    ? (type: string, by: string, value: string) =>
        cacheService.resolveEntityByKey(partnerId, "partner", type, by, value)
    : undefined
  tools.run_plan = buildRunPlanTool({
    ctx,
    tools: enabled,
    dispatch: (name, args) => dispatchPartnerTool(ctx, name, args),
    resolveEntity,
  })
  activated.add("run_plan")

  // This assistant REQUIRES tool calling. The free rotator ranks by context
  // length and can land on a text-only model ("No endpoints found that support
  // tool use"), so on the free path use the tool-capable variant (openrouter/
  // free). A DB-configured platform for this role overrides this entirely.
  const chatModel =
    resolved.source === "free" ? dynamicFreeToolTextModel : resolved.model

  // Identity first, then the prior-context cache: the block the model must not
  // second-guess should not sit below a block that is explicitly best-effort.
  const systemPrompt = buildSystemPrompt("partner", {
    domains: activeDomains,
    hasImages: attachments.length > 0,
  })
  const folded = foldSystemForProvider(
    resolved.providerType,
    [systemPrompt, identityBlock, priorContext].filter(Boolean).join("\n\n"),
    messages
  )
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
        // Re-read `activated` before every step so tools loaded via
        // load_partner_tools become callable on the very next one.
        prepareStep: () => ({ activeTools: [...activated] }),
        stopWhen: stepCountIs(8),
        temperature: 0.3,
        // Let the AI SDK retry transient network/5xx failures at the model
        // layer. The free rotator separately self-heals free-tier expiry
        // (dynamic-text-model.ts), so this covers non-free providers and
        // generic upstream hiccups.
        maxRetries: 3,
        onFinish: async ({ usage: u, toolResults }: any) => {
          logAiUsage(logger, {
            ...usageBase,
            ok: true,
            ms: Date.now() - startedAt,
            tokens: u?.totalTokens,
          })

          // Fire-and-forget: cache what was found so the next conversation can
          // skip the same fetch. A failure here is logged and swallowed — the
          // conversation already completed, and a missing cache entry is
          // harmless.
          if (cacheService && partnerId) {
            try {
              const entries = extractContextFromTurn(toolResults, "partner")
              for (const entry of entries) {
                await cacheService.upsertContextEntry({
                  principalId: partnerId,
                  surface: "partner",
                  domain: entry.domain,
                  entityIds: entry.entityIds,
                  summary: entry.summary,
                  conversationId: body.id ?? null,
                  resolutions: entry.resolutions,
                })
              }
            } catch (e: any) {
              logger.debug?.(
                `[${FEATURE}] context cache write failed: ${e?.message}`
              )
            }
          }
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
