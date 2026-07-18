/**
 * POST /partners/assistant/summarize
 *
 * Context-compaction for the partner assistant. As a conversation grows it
 * approaches the model's context window; rather than silently truncating
 * (which the partner experiences as the assistant "forgetting"), the client
 * asks this endpoint to roll the older turns into a short summary. The
 * client then persists the trimmed thread (summary + recent turns) and the
 * next request to /chat stays within budget.
 *
 * Non-streaming `generateText` is fine here — the result is short and the
 * call is infrequent (only when the client's token estimate crosses the
 * threshold). Retries once on failure so a transient model error does not
 * block compaction.
 */
import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { convertToModelMessages, generateText } from "ai"
import { resolveRoleTextModel, logAiUsage } from "../../../../mastra/services/ai-platforms"
import { foldSystemForProvider } from "../../../store/ai/chat/system-fold-lib"
import type { PartnerAssistantSummarizeReq } from "./validators"

const FEATURE = "partners/assistant/summarize"
const ROLE = "ai_partner_assistant"

const SUMMARIZE_SYSTEM = `You are condensing a partner-portal assistant conversation so it can continue within a limited context window. Write a tight "Summary so far" the assistant can read instead of the earlier messages.

Rules:
- Capture decisions made, facts learned about the partner (name, persona, onboarding state), actions already taken (tool calls + their outcome), and any open follow-ups.
- Do NOT restate the whole conversation. Aim for 4–8 short bullet lines.
- Do NOT invent details. If something is uncertain, say "unclear".
- Write in the second person to the assistant ("The partner …", "You already …"). End with a one-line "Continue by:" hint.`

export const POST = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const logger: any = req.scope.resolve(ContainerRegistrationKeys.LOGGER)
  const body = (req as any).validatedBody as PartnerAssistantSummarizeReq

  const resolved = await resolveRoleTextModel(req.scope as any, ROLE)
  if (resolved.source === "free" && !process.env.OPENROUTER_API_KEY) {
    res.status(503).json({
      error:
        "The partner assistant is not configured. Add a platform with role ai_partner_assistant in Settings → External Platforms, or set OPENROUTER_API_KEY.",
    })
    return
  }

  // Keep only text parts — tool/reasoning parts are not useful for a summary
  // and would inflate the input tokens for nothing.
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
    return { role: m.role, parts: textParts.length ? textParts : [{ type: "text", text: "" }] }
  })

  const folded = foldSystemForProvider(resolved.providerType, SUMMARIZE_SYSTEM, messages)
  const startedAt = Date.now()
  const usageBase = {
    feature: FEATURE,
    role: ROLE,
    provider: resolved.providerType,
    source: resolved.source,
    platformId: resolved.platformId,
    model: resolved.modelId,
  } as const

  const MAX_ATTEMPTS = 2
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const { text } = await generateText({
        model: resolved.model,
        ...(folded.system ? { system: folded.system } : {}),
        messages: convertToModelMessages(folded.messages as any),
        temperature: 0.2,
        maxRetries: 3,
      })
      logAiUsage(logger, { ...usageBase, ok: true, ms: Date.now() - startedAt })
      res.status(200).json({ summary: text.trim() })
      return
    } catch (e: any) {
      logAiUsage(logger, {
        ...usageBase,
        ok: false,
        ms: Date.now() - startedAt,
        error: e,
      })
      if (attempt < MAX_ATTEMPTS) {
        await new Promise((r) => setTimeout(r, 400 * attempt))
        continue
      }
      res.status(502).json({ error: "Could not summarize the conversation. Please try again or start a new chat." })
      return
    }
  }
}
