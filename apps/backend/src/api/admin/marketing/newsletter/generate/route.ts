/**
 * POST /admin/marketing/newsletter/generate — in-editor "Write with AI" for
 * newsletters (#659). Generates a newsletter draft and returns it as editor
 * fields `{ title, content }` so the blog/page editor can drop it straight in —
 * NO persistence (the editor page IS the draft).
 *
 * The drafting model is resolved from the admin-configured social-platform AI
 * provider tagged `metadata.role = "ai_newsletter_drafter"` (mirrors the
 * `ai_digest_summary` pattern in partner-analytics-digest.ts); when none is
 * configured it falls back to the `OPENROUTER_API_KEY` env var. Reuses the pure,
 * unit-tested prompt/parse/map libs — only the provider resolution is new.
 *
 * Body (optional): { topic?: string } — an angle for this edition.
 */
import { MedusaRequest, MedusaResponse } from "@medusajs/framework"
import { generateText } from "ai"
import { createOpenRouter } from "@openrouter/ai-sdk-provider"
import {
  getAiPlatformForRole,
  buildChatModel,
  buildGenerateArgs,
} from "../../../../../mastra/services/ai-platforms"
import {
  buildNewsletterPrompt,
  parseNewsletterPayload,
} from "../../../../../workflows/marketing/generate-newsletter-draft"
import { buildNewsletterPrefill } from "../../newsletter-prefill-lib"

const NEWSLETTER_AI_ROLE = "ai_newsletter_drafter"
const DEFAULT_MODEL = "anthropic/claude-3.5-sonnet"

// IST calendar date (YYYY-MM-DD) for the prompt's "Date:" line.
function istDateString(d: Date): string {
  const ist = new Date(d.getTime() + 5.5 * 60 * 60 * 1000)
  return ist.toISOString().slice(0, 10)
}

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const body = (req.body ?? {}) as { topic?: string }
  const topic = typeof body.topic === "string" ? body.topic.trim() : undefined

  const prompt = buildNewsletterPrompt({
    topic,
    businessDescription: process.env.MARKETING_BUSINESS_DESCRIPTION,
    dateIst: istDateString(new Date()),
  })

  let rawOutput = ""
  let source: "platform" | "env" | "none" = "none"
  try {
    // 1) admin-configured provider for the role (preferred)
    const aiPlatform = await getAiPlatformForRole(
      req.scope as any,
      NEWSLETTER_AI_ROLE
    )
    if (aiPlatform) {
      const chatModel = buildChatModel(
        aiPlatform,
        aiPlatform.defaultModel || undefined
      )
      const result = await generateText({
        model: chatModel as any,
        ...buildGenerateArgs(aiPlatform, undefined, prompt),
        maxOutputTokens: 800,
      })
      rawOutput = (result.text || "").trim()
      source = "platform"
    } else if (process.env.OPENROUTER_API_KEY) {
      // 2) env fallback (mirrors the original generator's defaultAiGenerate)
      const openrouter = createOpenRouter({
        apiKey: process.env.OPENROUTER_API_KEY,
      })
      const result = await generateText({
        model: openrouter(process.env.MARKETING_IDEAS_MODEL || DEFAULT_MODEL),
        prompt,
        maxOutputTokens: 800,
      })
      rawOutput = (result.text || "").trim()
      source = "env"
    }
  } catch (error: any) {
    // eslint-disable-next-line no-console
    console.error("[newsletter/generate] AI error:", error?.message)
  }

  if (!rawOutput) {
    res.status(503).json({
      error:
        "No AI provider available. Configure a social-platform AI provider with role 'ai_newsletter_drafter', or set OPENROUTER_API_KEY.",
    })
    return
  }

  const payload = parseNewsletterPayload(rawOutput)
  const { title, content } = buildNewsletterPrefill(payload)
  res.json({ title, content, payload, source })
}
