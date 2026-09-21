import { generateText } from "ai"

import { resolveWhatsAppModel } from "./whatsapp-model"
import { isNaturalRunAcksEnabled } from "./whatsapp-run-ack-prompt"
import {
  allowedNumbersFrom,
  buildLineSystemPrompt,
  buildLineUserPrompt,
  composeLine,
  isLineUsable,
  type LineSpec,
} from "./whatsapp-line-prompt"

/**
 * Any one WhatsApp reply, in the partner's own language (#2216).
 *
 * The generalisation of `phraseRunAck`. Same promise, same failure behaviour,
 * same budget — the only difference is that the caller describes the situation
 * instead of choosing from three run-lifecycle intents.
 *
 * 🔴 THE CONSTANT IS THE CONTRACT, THE MODEL IS THE IMPROVEMENT.
 *
 * Every path through this function that is not a clean, verified success
 * returns `spec.fallback` — the exact string that shipped before it existed.
 * Flag off, no model configured, request failed, request too slow, reply
 * rejected: all of them are the old message, which is merely plain. The one
 * outcome this must never produce is silence, and the one thing it must never
 * produce is a sentence containing a code that does not exist.
 *
 * ⚠️ It therefore does not throw and does not log at error level. Whatever the
 * partner did is already committed by the time we are choosing words for it; a
 * phrasing problem must not surface as a failed action.
 *
 * ⚠️ Behind the SAME flag as the run acks. One switch for "the platform speaks
 * to partners in sentences" is easier to reason about under load than two, and
 * these messages are the same act as those: the platform replying to a person.
 */

/** A partner is waiting on their phone. Past this we stop waiting and send the constant. */
const PHRASING_TIMEOUT_MS = 3500

export async function phraseLine(
  scope: any,
  opts: { spec: LineSpec; language: string }
): Promise<string> {
  const { spec, language } = opts

  if (!isNaturalRunAcksEnabled()) return spec.fallback

  try {
    const resolved = await resolveWhatsAppModel(scope)
    if (!resolved?.model) return spec.fallback

    const generated = await Promise.race([
      generateText({
        model: resolved.model,
        system: buildLineSystemPrompt(language),
        prompt: buildLineUserPrompt(spec),
        /*
         * Small budget. This is one sentence; a larger allowance only buys the
         * chance of an essay that `isLineUsable` then throws away after the
         * partner has already waited for it.
         */
        maxOutputTokens: 120,
        temperature: 0.4,
      }),
      new Promise<null>((resolve) =>
        setTimeout(() => resolve(null), PHRASING_TIMEOUT_MS)
      ),
    ])

    const text = (generated as any)?.text
    if (!isLineUsable(text, allowedNumbersFrom(spec.facts))) {
      return spec.fallback
    }

    return composeLine(text, spec.tail)
  } catch {
    return spec.fallback
  }
}
