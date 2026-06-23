/**
 * generate-newsletter-draft.ts — #659 slice (report §12.4).
 *
 * The "AI newsletter draft generator": ask the LLM for a customer-facing
 * newsletter (subject / preheader / intro / sections / CTA) and persist it to
 * the EXISTING `marketing_draft` model as an OPERATOR-REVIEW draft. Sending is
 * NOT done here — drafts are reviewed/edited in the (separate) Newsletter editor
 * UI and later enqueued through the existing `src/jobs/process-email-queue.ts`.
 *
 * Reuses the verified generate-ideas-email wiring:
 *   - the AI call is an INJECTABLE `AiGenerateFn` (prompt in, text out) so CI
 *     never calls a live LLM; the Medusa workflow wrapper injects the real
 *     OpenRouter call (mirrors generate-ideas-email.ts:152-168).
 *
 * Unlike the tactical-ideas email this is CUSTOMER-FACING, so it does NOT read
 * internal metric snapshots — we never want raw platform GMV leaking into a
 * brand newsletter. The model is told to avoid inventing specific numbers.
 *
 * Pure, unit-tested helpers: `buildNewsletterPrompt`, `parseNewsletterPayload`,
 * `coerceNewsletterPayload`.
 */

import {
  createWorkflow,
  createStep,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import { generateText } from "ai"
import { createOpenRouter } from "@openrouter/ai-sdk-provider"

import { MARKETING_MODULE } from "../../modules/marketing"
import type { AiGenerateFn } from "./generate-ideas-email"

const DEFAULT_MODEL = "anthropic/claude-3.5-sonnet"

const DEFAULT_BUSINESS_DESCRIPTION =
  "JYT is a textile-production commerce platform: it runs an admin storefront " +
  "and onboards partner brands who sell their own products through per-partner " +
  "storefronts."

/** v1 newsletter voice rules — kept pure (the workflow may pass an override). */
export const NEWSLETTER_VOICE_RULES = [
  "Warm and brand-forward, but never hype. Sound like a real person, not an ad.",
  "Lead with value for the reader; keep paragraphs short and scannable.",
  "Do NOT invent specific numbers, percentages, prices, discounts, or dates.",
  "End with one clear, low-pressure call to action.",
].join("\n- ")

// IST = UTC+5:30. Return the IST calendar date (YYYY-MM-DD) for a UTC instant.
function istDateString(d: Date): string {
  const ist = new Date(d.getTime() + 5.5 * 60 * 60 * 1000)
  return ist.toISOString().slice(0, 10)
}

export type NewsletterSection = {
  heading: string
  body: string
}

export type NewsletterPayload = {
  subject: string
  preheader: string
  intro: string
  sections: NewsletterSection[]
  cta: string
  /** true when the model output could not be parsed as JSON and we fell back. */
  parse_error?: boolean
}

export type GenerateNewsletterDraftOptions = {
  /** Injected for tests; defaults to the real OpenRouter call. */
  aiGenerate?: AiGenerateFn
  /** Operator topic/angle for this newsletter (free text). */
  topic?: string
  /** Business description fed to the prompt. */
  businessDescription?: string
  /** Voice override. */
  voiceRules?: string
  /** Human label for the draft row; defaults to `newsletter-<IST date>`. */
  name?: string
  /** When true, persist as status="approved" (ready); else status="draft". */
  markReady?: boolean
  /** Reference "now"; defaults to current time. Used only for the default name. */
  now?: Date
}

export type GenerateNewsletterDraftResult = {
  generated: boolean
  draft_id: string | null
  name: string
  status: "draft" | "approved"
  model_used: string
  payload: NewsletterPayload
  parse_error: boolean
}

/**
 * Pure: build the newsletter generation prompt. Asks the model for a strict JSON
 * object so the output is structured + parseable (no numbered-list scraping).
 */
export function buildNewsletterPrompt(opts: {
  topic?: string
  businessDescription?: string
  voiceRules?: string
  dateIst: string
}): string {
  const business = opts.businessDescription || DEFAULT_BUSINESS_DESCRIPTION
  const voice = opts.voiceRules || NEWSLETTER_VOICE_RULES
  const topicLine = opts.topic?.trim()
    ? `TOPIC / ANGLE for this edition: ${opts.topic.trim()}`
    : `TOPIC / ANGLE: pick a useful, evergreen angle relevant to the business.`

  return [
    `You are the marketing editor writing a customer newsletter for this business.`,
    `Date: ${opts.dateIst}.`,
    ``,
    `BUSINESS:`,
    business,
    ``,
    topicLine,
    ``,
    `Write ONE newsletter edition. Respond with ONLY a single JSON object — no`,
    `prose, no markdown fences — with EXACTLY this shape:`,
    `{`,
    `  "subject": "string, <= 80 chars",`,
    `  "preheader": "string, <= 120 chars",`,
    `  "intro": "string, 1-2 short paragraphs",`,
    `  "sections": [ { "heading": "string", "body": "string" } ],`,
    `  "cta": "string, one clear call to action"`,
    `}`,
    `Provide 2-4 sections.`,
    ``,
    `VOICE:`,
    `- ${voice}`,
  ].join("\n")
}

function asString(v: unknown): string {
  if (typeof v === "string") return v.trim()
  if (v == null) return ""
  return String(v).trim()
}

/**
 * Pure: normalise an arbitrary parsed object into a well-formed NewsletterPayload.
 * Tolerant of missing/extra keys and section shape variants.
 */
export function coerceNewsletterPayload(raw: unknown): NewsletterPayload {
  const obj = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>

  const rawSections = Array.isArray(obj.sections) ? obj.sections : []
  const sections: NewsletterSection[] = rawSections
    .map((s) => {
      const sec = (s && typeof s === "object" ? s : {}) as Record<string, unknown>
      return {
        heading: asString(sec.heading ?? sec.title),
        body: asString(sec.body ?? sec.content ?? sec.text),
      }
    })
    .filter((s) => s.heading.length > 0 || s.body.length > 0)

  return {
    subject: asString(obj.subject),
    preheader: asString(obj.preheader ?? obj.preview),
    intro: asString(obj.intro ?? obj.introduction),
    sections,
    cta: asString(obj.cta ?? obj.call_to_action),
  }
}

/**
 * Pure: parse the model's raw text into a NewsletterPayload. Strips ```json
 * fences and grabs the outermost {...} block. On any parse failure, returns a
 * usable fallback (the raw text as a single section) with parse_error=true so
 * the operator can still review/edit it — we never throw on bad model output.
 */
export function parseNewsletterPayload(rawText: string): NewsletterPayload {
  const text = (rawText || "").trim()
  if (!text) {
    return {
      subject: "",
      preheader: "",
      intro: "",
      sections: [],
      cta: "",
      parse_error: true,
    }
  }

  // strip code fences and isolate the outermost JSON object.
  let candidate = text.replace(/```(?:json)?/gi, "").trim()
  const first = candidate.indexOf("{")
  const last = candidate.lastIndexOf("}")
  if (first !== -1 && last !== -1 && last > first) {
    candidate = candidate.slice(first, last + 1)
  }

  try {
    const parsed = JSON.parse(candidate)
    const payload = coerceNewsletterPayload(parsed)
    // a parse that yields no usable content is treated as a soft failure.
    const empty =
      !payload.subject && !payload.intro && payload.sections.length === 0
    return empty ? fallbackPayload(text) : payload
  } catch {
    return fallbackPayload(text)
  }
}

function fallbackPayload(rawText: string): NewsletterPayload {
  return {
    subject: "",
    preheader: "",
    intro: "",
    sections: [{ heading: "Draft", body: rawText }],
    cta: "",
    parse_error: true,
  }
}

/** The real LLM call. Mirrors generate-ideas-email.ts:152-168 (try/catch → ""). */
async function defaultAiGenerate(prompt: string): Promise<string> {
  try {
    const openrouter = createOpenRouter({
      apiKey: process.env.OPENROUTER_API_KEY,
    })
    const result = await generateText({
      model: openrouter(
        process.env.MARKETING_NEWSLETTER_MODEL ||
          process.env.MARKETING_IDEAS_MODEL ||
          DEFAULT_MODEL
      ),
      prompt,
      maxOutputTokens: 1200,
    })
    return (result.text || "").trim()
  } catch (error: any) {
    // eslint-disable-next-line no-console
    console.error("[generate-newsletter-draft] AI error:", error?.message)
    return ""
  }
}

/**
 * Core orchestration (no Medusa-step wrapper, so it's directly unit/integration
 * testable with a stubbed `aiGenerate`): build prompt → generate → parse →
 * persist a `marketing_draft` row (kind="newsletter").
 */
export async function generateNewsletterDraft(
  container: any,
  opts: GenerateNewsletterDraftOptions = {}
): Promise<GenerateNewsletterDraftResult> {
  const aiGenerate = opts.aiGenerate || defaultAiGenerate
  const now = opts.now || new Date()
  const dateIst = istDateString(now)
  const businessDescription =
    opts.businessDescription ||
    process.env.MARKETING_BUSINESS_DESCRIPTION ||
    DEFAULT_BUSINESS_DESCRIPTION
  const modelId =
    process.env.MARKETING_NEWSLETTER_MODEL ||
    process.env.MARKETING_IDEAS_MODEL ||
    DEFAULT_MODEL
  const name = opts.name?.trim() || `newsletter-${dateIst}`
  const status: "draft" | "approved" = opts.markReady ? "approved" : "draft"

  const prompt = buildNewsletterPrompt({
    topic: opts.topic,
    businessDescription,
    voiceRules: opts.voiceRules,
    dateIst,
  })

  const rawOutput = await aiGenerate(prompt)
  const payload = parseNewsletterPayload(rawOutput)
  const parseError = payload.parse_error === true

  const marketing: any = container.resolve(MARKETING_MODULE)
  const created = await marketing.createMarketingDrafts([
    {
      name,
      kind: "newsletter",
      status,
      payload,
      model_used: modelId,
      approved_by: opts.markReady ? "ops:generate-marketing-newsletter-draft" : null,
    },
  ])

  return {
    generated: true,
    draft_id: arrId(created),
    name,
    status,
    model_used: modelId,
    payload,
    parse_error: parseError,
  }
}

function arrId(created: any): string | null {
  const row = Array.isArray(created) ? created[0] : created
  return row?.id ?? null
}

// ---------------------------------------------------------------------------
// Medusa workflow wrapper (injects the real OpenRouter call).
// ---------------------------------------------------------------------------
export type GenerateNewsletterDraftWorkflowInput = {
  topic?: string
  businessDescription?: string
  name?: string
  markReady?: boolean
}

const generateNewsletterDraftStep = createStep(
  "generate-newsletter-draft",
  async (input: GenerateNewsletterDraftWorkflowInput, { container }) => {
    const result = await generateNewsletterDraft(container, {
      topic: input?.topic,
      businessDescription: input?.businessDescription,
      name: input?.name,
      markReady: input?.markReady,
    })
    return new StepResponse(result)
  }
)

export const generateNewsletterDraftWorkflow = createWorkflow(
  "generate-newsletter-draft",
  (input: GenerateNewsletterDraftWorkflowInput) => {
    const result = generateNewsletterDraftStep(input)
    return new WorkflowResponse(result)
  }
)

export default generateNewsletterDraftWorkflow
