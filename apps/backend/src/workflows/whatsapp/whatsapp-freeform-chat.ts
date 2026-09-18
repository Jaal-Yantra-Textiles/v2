/**
 * Free-form WhatsApp partner chat — the LLM behind natural-language replies.
 *
 * Today the WhatsApp handler answers partners with either template-driven
 * reminders or a fixed command grammar (`accept`, `start`, `finish`, …). A
 * message that matches neither is silently saved to the inbox. This module
 * turns that tail into a conversation: when a partner writes something free-
 * form ("getting ready", "will finish tomorrow", "is the design approved?"),
 * an LLM answers in natural language, grounded on the partner's live
 * production runs, designs and payments, and may ask a single follow-up
 * question ("could you share a photo?").
 *
 * Design notes (deliberate, not accidental):
 *
 * - Reactive only. WhatsApp's business API forbids free-form messages outside
 *   a 24-hour customer-service window, so this ONLY replies to a partner who
 *   has just messaged us. Out-of-window reminders stay templates — that is a
 *   Meta constraint, not an omission.
 *
 * - Context-in-prompt + read-only tools. The common "what's the status of X"
 *   question is answered straight from a compact context block in the system
 *   prompt (no tool round-trip, works on free models). Two read-only tools
 *   (`lookup_design`, `lookup_run`) cover specific follow-up lookups. There are
 *   deliberately NO write tools here — the agent converses, it does not mutate
 *   production records; capture still goes through the existing command
 *   grammar and the human inbox.
 *
 * - Provider resolution mirrors the partner assistant: an admin-configured
 *   External Platform tagged `ai_whatsapp_partner_chat` (falling back to
 *   `ai_partner_assistant`, then the tool-capable OpenRouter free model).
 *
 * - Gated behind `WHATSAPP_FREEFORM_CHAT_ENABLED` so it ships dark and can be
 *   turned on per environment without a deploy.
 *
 * The pure prompt/formatting helpers live in `whatsapp-freeform-prompt.ts` so
 * they unit-test without dragging in the AI SDK.
 */
import { generateText, tool, stepCountIs } from "ai"
import { z } from "zod"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { PRODUCTION_RUNS_MODULE } from "../../modules/production_runs"
import { MESSAGING_MODULE } from "../../modules/messaging"
import { getPartnerOpenWork } from "./whatsapp-media-helper"
import {
  buildGenerateArgs,
  logAiUsage,
} from "../../mastra/services/ai-platforms"
import {
  FREEFORM_FEATURE,
  FREEFORM_ROLE,
  isFreeformChatEnabled,
  formatPartnerContext,
  formatConversationHistory,
  buildFreeformSystemPrompt,
  buildUserPrompt,
  type PartnerChatContext,
  type HistoryEntry,
} from "./whatsapp-freeform-prompt"
import { resolveWhatsAppModel } from "./whatsapp-model"

export { isFreeformChatEnabled }

export type FreeformReplyResult = {
  handled: boolean
  action: string
  error?: string
}

// ── Context + history collection ──────────────────────────────────────────

/**
 * Build the partner's live context pack (designs, open runs, pending payments).
 * Never throws — an empty pack degrades to "no open work on record" rather
 * than failing the reply.
 */

const DESIGN_FIELDS = [
  "id",
  "name",
  "status",
  "product_type",
  "target_completion_date",
]

/**
 * The designs this partner may be told about.
 *
 * 🔴 Fixing a real scoping bug. Both design reads here used
 * `entity: "designs", filters: { partner_id }` — and **the design model has no
 * `partner_id`.** It carries `owner_partner_id`, and designs reach a partner
 * through `links/design-partners-link.ts`, whose partner side declares
 * `filterable: ["id", "name"]`.
 *
 * So that filter was either ignored — in which case any partner could read any
 * design by name — or it threw, in which case the assistant was permanently
 * blind to designs. Both reads sat behind `.catch(() => [])` and a bare
 * `catch {}`, which made the two outcomes indistinguishable at runtime: the
 * leak and the blindness produce the same empty array in a log.
 *
 * This resolves ids the way the rest of the codebase does — the link table,
 * plus designs the partner OWNS — and then fetches by id. Same shape as
 * `workflows/designs/list-partner-designs.ts`.
 *
 * ⚠️ The link import is LAZY on purpose. `defineLink` throws at module
 * evaluation outside a container, and a top-level import of one has already
 * taken a whole jest suite down while the runner cheerfully reported the
 * neighbouring tests as passing.
 */
/**
 * Resolving the link's entry point is its own seam, and that is deliberate.
 *
 * ⚠️ `defineLink(...).entryPoint` is EMPTY outside a container, and importing
 * the module can throw outright at evaluation time. So a unit test can never
 * exercise the real link — only an integration test can. Making this injectable
 * means the SCOPING RULE stays testable even though the link itself is not:
 * tests supply an entry point, prod gets the lazy import.
 */
export type DesignLinkEntryPointResolver = () => Promise<string | null>

const defaultLinkEntryPoint: DesignLinkEntryPointResolver = async () => {
  // Lazy on purpose: a top-level import of a `defineLink` module throws at
  // module evaluation outside a container, and has already taken a whole jest
  // suite down while the runner reported its neighbours as passing.
  const mod: any = await import("../../links/design-partners-link.js")
  const link = mod.default ?? mod
  return link?.entryPoint || null
}

export async function resolvePartnerDesignIds(
  scope: any,
  partnerId: string,
  logger?: any,
  linkEntryPoint: DesignLinkEntryPointResolver = defaultLinkEntryPoint
): Promise<string[]> {
  const query = scope.resolve(ContainerRegistrationKeys.QUERY) as any
  const ids = new Set<string>()

  try {
    const entryPoint = await linkEntryPoint()
    if (!entryPoint) {
      // An empty entry point would query entity "" and return an empty array —
      // indistinguishable from "this partner has no designs". Refuse to make
      // that call rather than let it answer.
      throw new Error("design↔partner link entry point unavailable")
    }
    const { data } = await query.graph({
      entity: entryPoint,
      fields: ["design_id"],
      filters: { partner_id: partnerId },
      pagination: { skip: 0, take: 200 },
    } as any)
    for (const row of data ?? []) {
      if (row?.design_id) ids.add(String(row.design_id))
    }
  } catch (e: any) {
    // Narrow, and LOUD. A scoping query that fails must not read as "this
    // partner has no designs" — that is the shape the original bug hid in.
    logger?.warn?.(
      `[whatsapp-freeform] design link lookup failed for partner ${partnerId}: ${e?.message}`
    )
  }

  try {
    const { data: owned } = await query.graph({
      entity: "design",
      fields: ["id"],
      filters: { owner_partner_id: partnerId },
      pagination: { skip: 0, take: 50 },
    } as any)
    for (const d of owned ?? []) {
      if (d?.id) ids.add(String(d.id))
    }
  } catch (e: any) {
    logger?.warn?.(
      `[whatsapp-freeform] owned-design lookup failed for partner ${partnerId}: ${e?.message}`
    )
  }

  return Array.from(ids)
}

async function buildPartnerChatContext(
  scope: any,
  partnerId: string
): Promise<PartnerChatContext> {
  const query = scope.resolve(ContainerRegistrationKeys.QUERY) as any

  const logger = (() => {
    try {
      return scope.resolve(ContainerRegistrationKeys.LOGGER)
    } catch {
      return undefined
    }
  })()

  const designsPromise = resolvePartnerDesignIds(scope, partnerId, logger)
    .then(async (ids) => {
      if (!ids.length) {
        return [] as PartnerChatContext["designs"]
      }
      const { data } = await query.graph({
        entity: "designs",
        fields: DESIGN_FIELDS,
        filters: { id: ids },
        pagination: { skip: 0, take: 20 },
      } as any)
      return (data ?? []) as PartnerChatContext["designs"]
    })
    .catch((e: any) => {
      logger?.warn?.(
        `[whatsapp-freeform] design context failed for partner ${partnerId}: ${e?.message}`
      )
      return [] as PartnerChatContext["designs"]
    })

  const workPromise = getPartnerOpenWork(scope, partnerId).catch(() => ({
    pendingRuns: [] as any[],
    pendingPayments: [] as any[],
  }))

  const [designs, work] = await Promise.all([designsPromise, workPromise])

  return {
    designs,
    openRuns: work.pendingRuns.map((r: any) => ({
      id: r.id,
      status: r.status,
      accepted: r.accepted,
      designName: r.designName,
    })),
    pendingPayments: work.pendingPayments.map((p: any) => ({
      id: p.id,
      status: p.status,
      totalAmount: p.totalAmount,
      currency: p.currency,
    })),
  }
}

/**
 * How many prior turns the free-form assistant is allowed to remember. Bounded
 * both to keep the prompt small and because a WhatsApp thread can run for
 * weeks — the last N real messages is the working memory, and anything older
 * is dropped. Tunable per environment.
 */
function historyLimit(): number {
  const raw = parseInt(process.env.WHATSAPP_FREEFORM_HISTORY_LIMIT || "", 10)
  if (Number.isFinite(raw) && raw > 0) return Math.min(raw, 30)
  return 12
}

/**
 * Read the last few real messages in this conversation, newest-last, skipping
 * interactive-button and media rows (they carry no prose worth summarising).
 */
async function collectHistory(
  scope: any,
  conversationId: string | null,
  limit = historyLimit()
): Promise<HistoryEntry[]> {
  if (!conversationId) return []
  const messagingService = scope.resolve(MESSAGING_MODULE) as any
  const rows = await messagingService
    .listMessagingMessages(
      { conversation_id: conversationId },
      { take: limit * 2, order: { created_at: "DESC" } }
    )
    .catch(() => [] as any[])

  const entries: HistoryEntry[] = []
  for (const m of (rows ?? []).slice().reverse()) {
    if (entries.length >= limit) break
    if (m.direction !== "inbound" && m.direction !== "outbound") continue
    if (m.message_type === "interactive" || m.message_type === "media" || m.message_type === "context_card") continue
    const content = typeof m.content === "string" ? m.content.trim() : ""
    if (!content) continue
    entries.push({ role: m.direction === "inbound" ? "partner" : "bot", content })
  }
  return entries
}

/**
 * Persist the detected script under `metadata.freeform_language` (its own key,
 * NOT `metadata.language`, which onboarding owns). Best-effort — a failure to
 * write it only means the next turn re-detects from history, which is already
 * stable because the history window carries the partner's prior messages.
 */
async function persistDetectedLanguage(
  scope: any,
  conversationId: string | null,
  language: string
): Promise<void> {
  if (!conversationId) return
  try {
    const messagingService = scope.resolve(MESSAGING_MODULE) as any
    const conversation = await messagingService.retrieveMessagingConversation(conversationId)
    const meta = (conversation?.metadata ?? {}) as Record<string, any>
    if (meta.freeform_language === language) return
    await messagingService.updateMessagingConversations({
      id: conversationId,
      metadata: { ...meta, freeform_language: language },
    })
  } catch {
    /* non-fatal */
  }
}

// ── Read-only tools ───────────────────────────────────────────────────────

function createLookupRunTool(scope: any, partnerId: string) {
  return tool({
    description:
      "Look up the LIVE status and progress of one production run by its id (e.g. prod_run_...). Use it when the partner asks about a specific run whose details aren't already in your context.",
    inputSchema: z.object({
      run_id: z.string().describe("Production run id, e.g. prod_run_..."),
    }),
    execute: async ({ run_id }) => {
      try {
        const productionRunService = scope.resolve(PRODUCTION_RUNS_MODULE) as any
        const run = await productionRunService.retrieveProductionRun(run_id)
        if (!run || run.partner_id !== partnerId) return { found: false }
        return {
          found: true,
          id: run.id,
          status: run.status,
          run_type: run.run_type ?? null,
          quantity: run.quantity ?? null,
          produced_quantity: run.produced_quantity ?? null,
          rejected_quantity: run.rejected_quantity ?? null,
          started_at: run.started_at ?? null,
          finished_at: run.finished_at ?? null,
          design_name: run.design?.name ?? null,
        }
      } catch {
        return { found: false }
      }
    },
  })
}

function createLookupDesignTool(scope: any, partnerId: string) {
  return tool({
    description:
      "Look up the LIVE status and details of ONE design by its id (design_...) or by name. Use it when the partner asks about a specific design whose status isn't already in your context.",
    inputSchema: z.object({
      q: z.string().describe("Design id (e.g. design_...) or a name/substring to search."),
    }),
    execute: async ({ q }) => {
      const query = scope.resolve(ContainerRegistrationKeys.QUERY) as any
      const logger = (() => {
        try {
          return scope.resolve(ContainerRegistrationKeys.LOGGER)
        } catch {
          return undefined
        }
      })()
      const mapDesign = (d: any) => ({
        found: true,
        id: d.id,
        name: d.name ?? d.title ?? d.id,
        status: d.status,
        product_type: d.product_type ?? null,
        target_completion_date: d.target_completion_date ?? null,
      })

      // 🔴 Scope FIRST, then search. The previous version filtered designs on a
      // `partner_id` field the model does not have, so the scope was decided by
      // a filter that could not work — see `resolvePartnerDesignIds`.
      const allowed = await resolvePartnerDesignIds(scope, partnerId, logger)
      if (!allowed.length) {
        return { found: false }
      }

      const needle = String(q ?? "").trim()
      if (!needle) {
        return { found: false }
      }

      // An exact id is only answerable if it is one of theirs. A design that
      // exists but is not this partner's must be indistinguishable from one
      // that does not exist, or the tool becomes an existence oracle.
      if (allowed.includes(needle)) {
        try {
          const { data } = await query.graph({
            entity: "designs",
            fields: DESIGN_FIELDS,
            filters: { id: needle },
          } as any)
          if (data?.[0]) return mapDesign(data[0])
        } catch (e: any) {
          logger?.warn?.(`[whatsapp-freeform] lookup_design by id failed: ${e?.message}`)
        }
      }

      // Name search, constrained to their own designs and matched in memory —
      // `q` is a route-level convention, not a `query.graph` filter, so passing
      // it as one matched nothing (or everything).
      try {
        const { data } = await query.graph({
          entity: "designs",
          fields: DESIGN_FIELDS,
          filters: { id: allowed },
          pagination: { skip: 0, take: 200 },
        } as any)
        const lower = needle.toLowerCase()
        const hit = (data ?? []).find((d: any) =>
          String(d?.name ?? "").toLowerCase().includes(lower)
        )
        if (hit) return mapDesign(hit)
      } catch (e: any) {
        logger?.warn?.(`[whatsapp-freeform] lookup_design by name failed: ${e?.message}`)
      }

      return { found: false }
    },
  })
}

// ── Main entry ────────────────────────────────────────────────────────────

/**
 * Answer a partner's free-form WhatsApp message with a natural-language reply.
 * Resolves the model, packs live context, replays recent history, then asks
 * the LLM to write a short reply (allowed one read-only tool round-trip or two).
 * The reply is sent through the caller-supplied `whatsapp` wrapper (which
 * persists it to the messaging module) — this function itself writes nothing.
 *
 * Never throws: an LLM failure returns `{ handled: true, action: "freeform_error" }`
 * so the webhook still acks and the message remains visible in the inbox.
 */
export async function handleFreeFormPartnerReply(
  scope: any,
  opts: {
    text: string
    phone: string
    partnerId: string
    partnerName: string
    conversationId: string | null
    whatsapp: any
    language?: string
  }
): Promise<FreeformReplyResult> {
  const logger = scope.resolve(ContainerRegistrationKeys.LOGGER) as any
  const started = Date.now()
  const resolved = await resolveWhatsAppModel(scope)

  const [context, history] = await Promise.all([
    buildPartnerChatContext(scope, opts.partnerId),
    collectHistory(scope, opts.conversationId),
  ])

  // Language comes from the intent "query planner" (whatsapp-intent.ts), which
  // the caller already ran — this function just honours it. No regex here: the
  // model evaluated the script.
  const effectiveLanguage = opts.language

  // Persist the evaluated language under its own metadata key so the next turn
  // and other readers can see it (onboarding still owns `metadata.language`).
  if (effectiveLanguage) {
    await persistDetectedLanguage(scope, opts.conversationId, effectiveLanguage)
  }

  const system = buildFreeformSystemPrompt({
    partnerName: opts.partnerName,
    language: effectiveLanguage,
    contextText: formatPartnerContext(context),
  })
  const user = buildUserPrompt({
    historyText: formatConversationHistory(history),
    partnerName: opts.partnerName,
    incomingText: opts.text,
  })

  const tools = {
    lookup_design: createLookupDesignTool(scope, opts.partnerId),
    lookup_run: createLookupRunTool(scope, opts.partnerId),
  }

  try {
    const res = await generateText({
      model: resolved.model,
      ...buildGenerateArgs({ providerType: resolved.providerType }, system, user),
      tools,
      stopWhen: stepCountIs(4),
      maxOutputTokens: 600,
      temperature: 0.6,
    })

    const reply = (res.text || "").trim()
    logAiUsage(logger, {
      feature: FREEFORM_FEATURE,
      role: FREEFORM_ROLE,
      provider: resolved.providerType,
      source: resolved.source,
      model: resolved.modelId,
      platformId: resolved.platformId,
      ok: true,
      ms: Date.now() - started,
      tokens: (res as any)?.usage?.totalTokens,
    })

    if (!reply) return { handled: true, action: "freeform_empty" }
    await opts.whatsapp.sendTextMessage(opts.phone, reply)
    return { handled: true, action: "freeform_reply" }
  } catch (e: any) {
    logAiUsage(logger, {
      feature: FREEFORM_FEATURE,
      role: FREEFORM_ROLE,
      provider: resolved.providerType,
      source: resolved.source,
      model: resolved.modelId,
      platformId: resolved.platformId,
      ok: false,
      ms: Date.now() - started,
      error: e,
    })
    return { handled: true, action: "freeform_error", error: e?.message ?? String(e) }
  }
}