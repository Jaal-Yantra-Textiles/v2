import { generateText } from "ai"

import { resolveWhatsAppModel } from "./whatsapp-model"
import {
  buildRunAckSystemPrompt,
  buildRunAckUserPrompt,
  composeRunAck,
  isNaturalRunAcksEnabled,
  isRunAckUsable,
  type RunAckFacts,
  type RunAckIntent,
} from "./whatsapp-run-ack-prompt"

/**
 * The run-lifecycle acknowledgement, in the partner's own language.
 *
 * 🔴 THE CONSTANT IS THE CONTRACT, THE MODEL IS THE IMPROVEMENT.
 *
 * Every path through this function that is not a clean, verified success
 * returns the caller's `fallback` — the exact string that shipped before it
 * existed. Flag off, no model configured, request failed, request too slow,
 * reply rejected by `isRunAckUsable`: all of them are the old message, which
 * is merely plain. The one outcome this must never produce is silence, and
 * the one thing it must never produce is a sentence containing a code that
 * does not exist.
 *
 * ⚠️ It therefore does not throw and does not log at error level. A partner's
 * Accept is already committed by the time we are choosing words for it; a
 * phrasing problem must not surface as a failed action.
 */

/** A partner is waiting on their phone. Past this we stop waiting and send the constant. */
const PHRASING_TIMEOUT_MS = 3500

export async function phraseRunAck(
  scope: any,
  opts: {
    intent: RunAckIntent
    facts: RunAckFacts
    language: string
    /** The pre-existing constant. Returned whenever anything is not perfect. */
    fallback: string
  }
): Promise<string> {
  if (!isNaturalRunAcksEnabled()) return opts.fallback

  try {
    const resolved = await resolveWhatsAppModel(scope)
    if (!resolved?.model) return opts.fallback

    const generated = await Promise.race([
      generateText({
        model: resolved.model,
        system: buildRunAckSystemPrompt(opts.language),
        prompt: buildRunAckUserPrompt({
          intent: opts.intent,
          facts: opts.facts,
        }),
        /*
         * Small budget. This is one sentence; a larger allowance only buys
         * the chance of an essay that `isRunAckUsable` then throws away
         * after the partner has already waited for it.
         */
        maxOutputTokens: 120,
        temperature: 0.4,
      }),
      new Promise<null>((resolve) =>
        setTimeout(() => resolve(null), PHRASING_TIMEOUT_MS)
      ),
    ])

    const text = (generated as any)?.text
    if (!isRunAckUsable(text, opts.facts)) return opts.fallback

    return composeRunAck(text, opts.facts)
  } catch {
    return opts.fallback
  }
}
