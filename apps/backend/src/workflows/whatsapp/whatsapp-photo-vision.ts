import { generateText } from "ai"

import {
  buildChatModel,
  getAiPlatformForRole,
} from "../../mastra/services/ai-platforms"
import { sanitizeTemplateParam } from "./whatsapp-template-params"

/**
 * #2138 — look at the photo, say what is IN it, and stop there.
 *
 * ## Observation, not intent
 *
 * This is the half of the photo problem a model can actually answer. "What is
 * in this image" is a question about the image. "What does the partner want
 * done with it" is a question about the PERSON, and no amount of looking at
 * pixels answers it — a photograph of folded cloth is identical whether they
 * are selling it to us, showing us a defect, or confirming they received it.
 *
 * That distinction is the whole lesson of the `trousers` incident: a FABRIC
 * was classified as a garment at confidence 1.00 because the question
 * presupposed its own subject. So this prompt is deliberately barred from
 * concluding anything about purpose, and its output is fed to the QUESTION we
 * ask the partner — never to a decision.
 *
 * What it buys us is a much better question. "Thanks — what would you like
 * done with this?" is a shrug. "Thanks — I can see what looks like a stack of
 * woven fabric; what would you like done with it?" tells the partner we
 * actually looked, and is far more likely to get a useful answer.
 *
 * ## Model
 *
 * Resolved from the `ai_image_extraction` External Platform role, so the
 * provider is an admin choice rather than a constant — including z.ai's
 * GLM-4.6V-Flash, which is free for input, output and caching.
 *
 * Never throws. A description is a nicety; failing to get one must never stop
 * the partner being asked, so every failure path returns null and the caller
 * asks the plainer question.
 */

/** A description longer than this stops being a hint and becomes an essay. */
const MAX_DESCRIPTION_CHARS = 240

const SYSTEM_PROMPT = [
  "You describe a photograph sent by a textile manufacturing partner over WhatsApp.",
  "",
  "Say only what is VISIBLE. One short sentence, at most 25 words.",
  "",
  "🔴 Do NOT say what the photo is FOR, what the sender wants, or what should happen next.",
  "You cannot see intent. A photograph of cloth looks the same whether it is being",
  "sold, shipped, complained about or shown off, and guessing is worse than not knowing.",
  "",
  "Do not invent quantities, prices, measurements, materials or brand names you cannot read.",
  "If the image is unclear, say so plainly.",
  "",
  "Examples of the right shape:",
  '- "A stack of folded woven fabric in deep indigo, on a wooden table."',
  '- "A printed document, too blurred to read."',
  '- "A person holding up a finished jacket against a plain wall."',
].join("\n")

export type PhotoDescription = {
  text: string
  /** Which platform produced it — useful when a description reads oddly. */
  platformId?: string
  modelId?: string
}

/**
 * Describe one photo. Returns null when no vision model is reachable, the call
 * fails, or the model returns nothing usable.
 */
export async function describePhotoForContext(
  scope: any,
  imageUrl: string,
  timeoutMs = 20_000
): Promise<PhotoDescription | null> {
  if (!imageUrl) return null

  let cfg: any
  try {
    cfg = await getAiPlatformForRole(scope, "ai_image_extraction" as any)
  } catch {
    return null
  }
  if (!cfg) return null

  try {
    const { text } = await generateText({
      model: buildChatModel(cfg),
      abortSignal: AbortSignal.timeout(timeoutMs),
      maxOutputTokens: 120,
      temperature: 0.2,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: [
            { type: "image", image: imageUrl },
            { type: "text", text: "Describe this photograph." },
          ],
        },
      ] as any,
    })

    // The description rides inside a WhatsApp message, so it obeys the same
    // parameter rules as anything else we send: no newlines, no tabs, capped.
    const cleaned = sanitizeTemplateParam(text ?? "", MAX_DESCRIPTION_CHARS)
    if (!cleaned.text || cleaned.text === "—") return null

    return {
      text: cleaned.text,
      platformId: cfg.platformId,
      modelId: cfg.defaultModel ?? undefined,
    }
  } catch {
    // A missing description is a plainer question, not a failure.
    return null
  }
}

/**
 * PURE: fold what we saw into the batch's question. Exported for tests.
 *
 * 🔴 Hedged on purpose — "looks like", and the partner is told plainly that we
 * are guessing at the contents. A confident description of the wrong thing
 * ("your green silk") makes a partner correct us before they answer, or worse,
 * agree with something untrue. One description is quoted even when several
 * photos arrived, because a list of five descriptions is not a question.
 */
export function describeBatchForQuestion(
  descriptions: Array<string | null | undefined>
): string | null {
  const first = (descriptions ?? []).find(
    (d) => typeof d === "string" && d.trim().length > 0
  )
  if (!first) return null

  const n = (descriptions ?? []).filter(
    (d) => typeof d === "string" && d.trim().length > 0
  ).length

  const seen = first!.trim().replace(/\.$/, "")
  return n > 1
    ? `the first of them looks like ${lowerFirst(seen)}`
    : `it looks like ${lowerFirst(seen)}`
}

const lowerFirst = (s: string): string =>
  s.length ? s[0].toLowerCase() + s.slice(1) : s
