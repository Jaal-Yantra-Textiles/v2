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
  selectAdminToolSlice,
  toolsInDomains,
  widenedDomainsFromHistory,
  toolDomain,
  SELECTABLE_DOMAINS,
} from "../../mcp/lib/tool-slice"
import {
  dispatchAdminTool,
  buildToolInputSchema,
  isSensitive,
  isDangerous,
  type AdminMcpContext,
} from "../../mcp/lib/dispatch"
import {
  resolveAdminBaseUrl,
  resolveAdminMcpScope,
} from "../../mcp/lib/handler"
import { mcpScopeToContextFlags } from "../../../../lib/mcp-scope"
import { makeMcpLedgerSink } from "../../../../lib/mcp-ledger"
import {
  extractContextFromTurn,
  loadAndFormatContext,
  resolveContextCache,
} from "../../../../lib/assistant-context"
import type { AdminAssistantChatReq } from "./validators"

const FEATURE = "admin/assistant/chat"
const ROLE = "ai_admin_assistant"

/**
 * Ceiling on a single tool result, in serialised bytes.
 *
 * A tool result is streamed to the client, stored in the thread, and sent back
 * up on EVERY subsequent turn — so one large result is paid for repeatedly. A
 * Data Plumbing sweep returns one `changes` row per affected record, which for
 * a wide backfill runs to hundreds of kB and used to push the next request past
 * the body limit ("Payload too large"). Raising that limit was the actual fix;
 * this keeps a single job from silently eating the whole budget anyway.
 *
 * 64kB is far more than any result a human reads in a chat, and the model gets
 * an explicit note that it was truncated rather than a silently short list.
 */
const MAX_TOOL_RESULT_BYTES = 64 * 1024

/**
 * Trim an oversized tool result to something a thread can carry.
 *
 * Arrays are the only thing that grows without bound here (`changes`, `runs`,
 * result rows), so the biggest one is truncated and annotated. The summary,
 * counts and every scalar field survive untouched — those are what the operator
 * is reading, and dropping them to save bytes would defeat the point.
 */
export const capToolResult = (result: any): any => {
  if (!result || typeof result !== "object") {
    return result
  }

  const size = (v: unknown) => {
    try {
      return JSON.stringify(v)?.length ?? 0
    } catch {
      return 0
    }
  }

  if (size(result) <= MAX_TOOL_RESULT_BYTES) {
    return result
  }

  // Walk one level into the payload — tool results are `{ data: {...} }` or a
  // flat object; either way the unbounded arrays sit at the top of one of them.
  const trimContainer = (obj: any): any => {
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) {
      return obj
    }
    const entries = Object.entries(obj)
    const biggest = entries
      .filter(([, v]) => Array.isArray(v) && v.length > 1)
      .sort((a, b) => size(b[1]) - size(a[1]))[0]

    if (!biggest) {
      return obj
    }

    const [key, arr] = biggest as [string, unknown[]]
    // Keep whatever prefix fits, always at least one row so the shape is legible.
    let keep = arr.length
    while (keep > 1 && size(arr.slice(0, keep)) > MAX_TOOL_RESULT_BYTES / 2) {
      keep = Math.floor(keep / 2)
    }

    return {
      ...obj,
      [key]: arr.slice(0, keep),
      truncated: {
        field: key,
        shown: keep,
        total: arr.length,
        note: `${key} was truncated to keep the conversation within its size budget. ${
          arr.length - keep
        } more row(s) exist — narrow the request, or read the full set via the audit log / admin UI.`,
      },
    }
  }

  const trimmed = trimContainer(result)
  if (size(trimmed) <= MAX_TOOL_RESULT_BYTES) {
    return trimmed
  }
  if (result.data && typeof result.data === "object") {
    return { ...result, data: trimContainer(result.data) }
  }
  return trimmed
}

const SYSTEM_PROMPT = `You are the JYT admin assistant. You help platform operators run the business by calling Admin API tools on their behalf — reading orders, products, customers, partners, stores, designs, production runs, inventory, payments and campaigns, and (in later tiers) acting on them.

## How to work
- ALWAYS call \`get_admin_stats\` first to ground yourself in the platform's current shape before answering operational questions.
- Use the read tools (list_orders, list_products, list_customers, list_partners, list_designs, list_production_runs, list_inventory_items, list_payments, ...) to answer "what's happening" questions. Fetch a single record with the get_* tools when you have an id.
- Prefer doing (calling a tool) over describing. Chain tools to complete a goal, and set each tool's \`context\` to what you're ultimately trying to accomplish.

## Your tools are loaded on demand
You are given the tools for the domains this conversation appears to be about, not the full admin surface. If the tool you need is not in your list, DO NOT tell the user it is impossible or improvise with a different tool — call \`load_admin_tools\` with the relevant domains (orders, catalog, customers, partners, designs, production, inventory, money, marketing, observability) and the tools become callable on your next step. Loading a domain you turn out not to need is harmless.

## Safety rails (important)
- Every tool accepts \`dry_run: true\`. Use it to PREVIEW a change and inspect the current object before you actually write.
- Sensitive/destructive tools refuse to run unless the user confirms. Never set \`confirm: true\` yourself. If a tool returns \`requires_confirmation\`, tell the user plainly what it will do and ask them to approve — the UI gives them a button.
- Platform-destructive ("dangerous") tools additionally require a \`reason\`. If a tool returns \`requires_reason\`, ask the operator WHY they want to do it and pass their answer as the reason. Never invent a reason.

## Images the operator attaches
Attached images are uploaded and listed for you as \`[attachment N]\` lines with a url — but you CANNOT see them. Nothing about their content is available to you unless you go and read them.
- Do NOT read an image just because it was attached. Most attachments are there to be filed against a record (a design's reference, an inventory item's photo), not interpreted, and reading costs real time and money.
- Read one ONLY when the operator asks you to, or when they ask for something that is impossible without it ("add the raw materials from this photo", "what does this note say"). Then call \`read_image\` with the attachment's url and a specific question.
- \`extract_inventory_from_image\` is the purpose-built path for "create raw materials / inventory from this photo" — prefer it over \`read_image\` + manual creation, and keep \`persist: false\` until the operator has seen and approved the extraction.
- If a read fails, relay the reason verbatim — they are all actionable (no vision provider configured, a text-only model, a licence-gated model). Never retry silently and never guess at what the image showed.

## Turning an idea into a design
When an operator describes an idea — with or without a reference image or Pinterest link — build it out properly instead of creating a bare named record:
1. \`create_design\` with the name, description and \`inspiration_sources\` (put the reference link there; a link they gave you and you dropped is a link they have to find again). Set \`thumbnail_url\` to the reference image when there is one.
2. \`update_design_brief\` for the attributes that describe the IDEA — concept theme, aesthetic keywords, persona, price point. Take these from what the operator said; ask rather than invent a persona.
3. \`list_construction_techniques\` then \`add_design_construction_detail\` for how the garment is actually made. The technique must be a slug from that list — the catalog IS the vocabulary, so map "gathered waist" onto the real slug rather than writing prose.
4. Materials: \`link_design_material_group\` to pin a material group, and/or \`link_design_inventory\` for the specific items and planned quantities.
5. \`link_design_partners\`, then \`create_design_production_run\` to actually put it into production.
Each of those is sensitive, so the operator approves each one — narrate what you're about to do, don't dump five approval cards without explanation.

## Style
- Be concise and operator-focused. After a successful change, confirm what you did in one short sentence.
- Never invent ids, values, or fields outside the tool schemas.`

/**
 * Tell the model an attachment EXISTS without sending a single pixel.
 *
 * The url is what makes it actionable: `read_image` and
 * `extract_inventory_from_image` both take one, so the model can act on an image
 * it cannot see, but only deliberately.
 */
const renderAttachments = (
  attachments: NonNullable<AdminAssistantChatReq["attachments"]>
): string =>
  [
    "",
    "---",
    `The operator attached ${attachments.length} file(s) to this message. You cannot see them.`,
    "Read one only if this request actually requires it (see: Images the operator attaches).",
    ...attachments.map(
      (a, i) =>
        `[attachment ${i + 1}] name=${a.name ?? "untitled"} type=${
          a.mime_type ?? "unknown"
        } url=${a.url}`
    ),
  ].join("\n")

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
  // via the shared dispatcher; the scope flags gate visibility.
  //
  // The level is min(process ceiling, this principal's mcp_access_scope row),
  // resolved exactly as the JSON-RPC endpoint does (#1306 Track C) — the two
  // tool surfaces must not disagree about what a credential may reach. In
  // practice this is the process ceiling, since the assistant is driven by a
  // human admin and scope rows are written for machine credentials.
  const { level: scopeLevel } = await resolveAdminMcpScope(req)
  const scopeFlags = mcpScopeToContextFlags(scopeLevel)
  const ctx: AdminMcpContext = {
    baseUrl: resolveAdminBaseUrl(req),
    bearer: req.get("authorization") || undefined,
    cookie: req.get("cookie") || undefined,
    ...scopeFlags,
    surface: "admin",
    observe: makeMcpLedgerSink(req.scope, {
      id: (req as any).auth_context?.actor_id ?? null,
      type: "admin",
    }),
  }
  const writeEnabled = ctx.enableWrite !== false
  const dangerousEnabled = ctx.enableDangerous === true
  const sensitiveEnabled = ctx.enableSensitive !== false

  // Bind the registry as AI-SDK tools. One source of truth (JSON Schema) feeds
  // both this binding and the MCP endpoint's tools/list. Disabled tiers are
  // hidden from the model entirely (and refused at dispatch as a backstop).
  const enabled = ADMIN_MCP_TOOLS.filter(
    (def) =>
      (writeEnabled || !def.write) &&
      (dangerousEnabled || !isDangerous(def)) &&
      (sensitiveEnabled || !isSensitive(def))
  )

  const tools: Record<string, any> = Object.fromEntries(
    enabled.map((def) => [
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
        execute: async (input: any) =>
          capToolResult(await dispatchAdminTool(ctx, def.name, input)),
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

  // Attachments ride on the LAST user message — the turn they were sent with.
  // Appended as text so every provider handles it identically; a provider that
  // can't do multimodal parts is not a special case here, because we never send
  // parts it would have to understand.
  const attachments = body.attachments ?? []
  if (attachments.length) {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "user") {
        messages[i].parts.push({ type: "text", text: renderAttachments(attachments) })
        break
      }
    }
  }

  // ---- Per-ask registry slicing -------------------------------------------
  // All ~100 tools stay BOUND (so any of them can still execute), but only the
  // slice this ask needs is serialised to the provider via `activeTools`.
  // Without this every turn re-sends the whole registry, which is both the
  // dominant token cost of a conversation and — because the free rotator ranks
  // by context length — a lever on which model answers.
  //
  // `activated` is the live slice. It starts from keyword matching on the recent
  // conversation and can only ever GROW, via load_admin_tools below, so a bad
  // initial guess costs one round trip rather than a capability.
  const recentText = messages
    .slice(-6)
    .map((m: any) => m.parts.map((p: any) => p.text).join(" "))
    .join("\n")

  const initialSlice = selectAdminToolSlice(recentText, enabled)
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
  // Read the domain-keyed cache for this principal and inject a thin "you
  // already found this" block into the system prompt. Lets the model skip a
  // re-fetch when the user repeats a task from a previous conversation.
  const adminUserId = (req as any).auth_context?.actor_id ?? null
  // Resolved defensively: the cache only ever saves a re-fetch, so it must
  // never be able to fail the turn (see lib/assistant-context/resolve).
  const cacheService = adminUserId ? resolveContextCache(req.scope, logger) : null
  const activeDomains = initialSlice.domains.filter((d) => d !== "core")
  const priorContext = cacheService
    ? await loadAndFormatContext(
        cacheService,
        adminUserId,
        "admin",
        activeDomains
      )
    : undefined

  // The escape hatch. Always active, so the model is never boxed in by a slice
  // that guessed wrong — it names the domains it needs and they light up on the
  // next step. This is also why the slice can be aggressive.
  tools.load_admin_tools = tool({
    description:
      "Load the tools for one or more admin domains when the tool you need is not currently available to you. " +
      `Valid domains: ${SELECTABLE_DOMAINS.join(", ")}. ` +
      "Returns the names and descriptions of the tools that just became callable — call them on your next step. " +
      "Use this instead of telling the user something is impossible.",
    inputSchema: jsonSchema({
      type: "object",
      properties: {
        domains: {
          type: "array",
          items: { type: "string", enum: SELECTABLE_DOMAINS },
          description: "The admin domains to load tools for.",
        },
      },
      required: ["domains"],
      additionalProperties: false,
    }),
    execute: async ({ domains }: { domains: string[] }) => {
      const names = toolsInDomains(domains ?? [], enabled)
      names.forEach((n) => activated.add(n))
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
      }
    },
  })
  activated.add("load_admin_tools")

  // This assistant REQUIRES tool calling. The free rotator ranks by context
  // length and can land on a text-only model, so on the free path use the
  // tool-capable variant. A DB-configured platform for this role overrides this.
  const chatModel =
    resolved.source === "free" ? dynamicFreeToolTextModel : resolved.model

  const folded = foldSystemForProvider(
    resolved.providerType,
    priorContext ? `${SYSTEM_PROMPT}\n\n${priorContext}` : SYSTEM_PROMPT,
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
        // load_admin_tools become callable on the very next one.
        prepareStep: () => ({ activeTools: [...activated] }),
        stopWhen: stepCountIs(8),
        temperature: 0.3,
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
          if (cacheService && adminUserId) {
            try {
              const entries = extractContextFromTurn(toolResults, "admin")
              for (const entry of entries) {
                await cacheService.upsertContextEntry({
                  principalId: adminUserId,
                  surface: "admin",
                  domain: entry.domain,
                  entityIds: entry.entityIds,
                  summary: entry.summary,
                  conversationId: body.id ?? null,
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
        await new Promise((r) => setTimeout(r, 400 * attempt))
        continue
      }
      res.status(502).json({ error: "admin assistant provider failed" })
      return
    }
  }

  result.pipeUIMessageStreamToResponse(res as any)
}
