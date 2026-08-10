/**
 * POST /admin/assistant/summarize
 *
 * Context-compaction for the admin assistant (#1238), mirroring
 * `/partners/assistant/summarize`. As a thread grows it approaches the model's
 * context window; rather than silently truncating — which the operator
 * experiences as the assistant "forgetting" what it just did — the client asks
 * this endpoint to roll the older turns into a short summary, stores the
 * trimmed thread, and the next /chat request stays within budget.
 *
 * Admin threads hit the ceiling sooner than partner ones because every tool
 * call carries its request and its JSON result, so the summary prompt is
 * explicitly told to preserve what was *done* (and to which ids) rather than
 * what was said.
 *
 * Non-streaming `generateText` is right here: the result is short and the call
 * is infrequent. Retries once so a transient model error does not block
 * compaction.
 */
import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { convertToModelMessages, generateText } from "ai"

import { resolveRoleTextModel, logAiUsage } from "../../../../mastra/services/ai-platforms"
import { foldSystemForProvider } from "../../../store/ai/chat/system-fold-lib"
import type { AdminAssistantSummarizeReq } from "./validators"

const FEATURE = "admin/assistant/summarize"
const ROLE = "ai_admin_assistant"

const SUMMARIZE_SYSTEM = `You are condensing an admin-console assistant conversation so it can continue within a limited context window. Write a tight "Summary so far" the assistant can read instead of the earlier messages.

Rules:
- Preserve what was DONE over what was said: tool calls made, the ids they touched (order/run/location/partner ids), and their outcome. An id the operator is mid-way through working on must survive compaction verbatim.
- Capture decisions taken, facts established about the platform's state, any action the operator approved or declined, and open follow-ups.
- Do NOT restate the whole conversation. Aim for 4-8 short bullet lines.
- Do NOT invent details. If something is uncertain, say "unclear".
- Write in the second person to the assistant ("The operator ...", "You already ..."). End with a one-line "Continue by:" hint.`

export const POST = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const logger: any = req.scope.resolve(ContainerRegistrationKeys.LOGGER)
  const body = (req as any).validatedBody as AdminAssistantSummarizeReq

  const resolved = await resolveRoleTextModel(req.scope as any, ROLE)
  if (resolved.source === "free" && !process.env.OPENROUTER_API_KEY) {
    res.status(503).json({
      error:
        "The admin assistant is not configured. Add a platform with role ai_admin_assistant in Settings → External Platforms, or set OPENROUTER_API_KEY.",
    })
    return
  }

  // Keep only text parts — tool and reasoning parts would inflate the input
  // tokens for nothing, and what those calls achieved is already narrated in
  // the assistant's own text.
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
      res.status(502).json({
        error:
          "Could not summarize the conversation. Please try again or start a new chat.",
      })
      return
    }
  }
}
