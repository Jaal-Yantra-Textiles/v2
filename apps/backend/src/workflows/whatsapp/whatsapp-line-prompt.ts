/**
 * One WhatsApp line, in the partner's language — the general case (#2216).
 *
 * `whatsapp-run-ack-prompt.ts` (#2213) did this for exactly three moments in a
 * run's life, with a fixed enum of intents and a fixed fact shape. The other
 * ~34 replies in `whatsapp-message-handler.ts` are still English constants
 * whatever language the partner chose, and the ones that read worst are the
 * failures — they arrive at the moment a partner is already confused.
 *
 * This module is that mechanism with the run-shaped assumptions removed: a
 * brief saying what the message must get across, a list of facts, and the
 * constant that ships if anything at all is not perfect.
 *
 * 🔴 THE RULES ARE NOT RE-STATED HERE, THEY ARE THE SAME RULES. The id check
 * and the number check live in this file and `whatsapp-run-ack-prompt.ts`
 * imports them, rather than each keeping its own copy. Two regexes that are
 * supposed to agree about what an identifier looks like will eventually
 * disagree, and the failure mode of that disagreement is a fabricated run id
 * reaching a partner.
 *
 * Pure on purpose — no AI SDK import — so the part worth testing tests without
 * one. The model call is `whatsapp-line.ts`.
 */

/** Longest we will send. Beyond this the model has started writing an essay. */
export const LINE_MAX_CHARS = 320

const LANGUAGE_NAME: Record<string, string> = {
  en: "English",
  hi: "Hindi",
}

export type LineFact = {
  label: string
  value: string | number
}

export type LineSpec = {
  /**
   * What this message has to get across, in the platform's own words. Written
   * as an instruction about the SITUATION, never as text to translate — a
   * brief that quotes the English constant gets the English constant back.
   */
  brief: string
  /** Shown to the model as "- Label: value". NEVER an identifier. */
  facts?: LineFact[]
  /**
   * Appended verbatim by code after the model's sentence. This is where an id
   * goes: the model is never shown one, so it cannot get one wrong.
   */
  tail?: string | null
  /** The pre-existing constant. Returned whenever anything is not perfect. */
  fallback: string
}

export function buildLineSystemPrompt(language: string): string {
  const name = LANGUAGE_NAME[language] || "English"
  return [
    `You write one short WhatsApp message to a textile production partner, in ${name}.`,
    "",
    "Rules:",
    `- Write in ${name}. Do not translate proper nouns such as a design name.`,
    "- One or two sentences. No greeting, no sign-off, no emoji.",
    "- Speak to them, not about them. Warm, plain, practical.",
    "- State only what the facts say. Never invent a date, a price or a status.",
    "- NEVER write an identifier, code or number that is not given in the facts.",
    "- Do not add questions. Do not offer to help further.",
    "- Return the message text only.",
  ].join("\n")
}

export function buildLineUserPrompt(spec: LineSpec): string {
  const lines = [`What happened: ${spec.brief}`]
  if (spec.facts?.length) {
    lines.push("", "Facts:")
    for (const f of spec.facts) {
      lines.push(`- ${f.label}: ${f.value}`)
    }
  }
  lines.push("", "Write the message.")
  return lines.join("\n")
}

/**
 * 🔴 An id-shaped token the model produced on its own.
 *
 * It was never given one, so any occurrence is invented. Checked rather than
 * trusted, because "the prompt says not to" is not a guarantee — and a
 * fabricated `prod_run_01M22…` one character off produces a message that looks
 * right, refers to nothing, and is indistinguishable from a real one.
 */
export const containsInventedId = (text: string): boolean =>
  /\b(prod_run|prun|ordli|inv_order|cus|order)_[A-Za-z0-9]{6,}/.test(text)

/**
 * A number the facts do not contain.
 *
 * Quantities decide money. A model that rounds 2 to "a couple" is fine; one
 * that writes 20 is not. Bare digits only — ordinals inside words ("2nd") are
 * left alone.
 */
export const containsUnknownNumber = (
  text: string,
  allowedNumbers: Array<number | string>
): boolean => {
  const allowed = new Set(allowedNumbers.map((n) => String(n)))
  for (const m of text.matchAll(/(?<![\w])\d+(?![\w])/g)) {
    if (!allowed.has(m[0])) return true
  }
  return false
}

/**
 * PURE: is this reply safe to send to a partner?
 *
 * Fails CLOSED — anything odd returns false and the caller sends the constant
 * it already had. A partner getting the old robotic line is a small loss; a
 * partner getting an empty message, a wall of text, or a sentence containing a
 * fabricated code is a real one.
 */
export function isLineUsable(
  text: unknown,
  allowedNumbers: Array<number | string> = []
): text is string {
  if (typeof text !== "string") return false
  const t = text.trim()
  if (!t) return false
  if (t.length > LINE_MAX_CHARS) return false
  if (containsInventedId(t)) return false
  if (containsUnknownNumber(t, allowedNumbers)) return false
  return true
}

/** Every number the model is allowed to reuse, taken from the facts themselves. */
export const allowedNumbersFrom = (facts?: LineFact[]): string[] =>
  (facts || [])
    .map((f) => f.value)
    .filter((v): v is number | string => v != null)
    .flatMap((v) =>
      typeof v === "number"
        ? [String(v)]
        : Array.from(String(v).matchAll(/(?<![\w])\d+(?![\w])/g)).map((m) => m[0])
    )

/**
 * The message actually sent: the model's sentence, then whatever the caller
 * wants appended verbatim — added by code so it cannot be wrong.
 */
export function composeLine(sentence: string, tail?: string | null): string {
  const s = sentence.trim()
  return tail ? `${s}\n\n${tail}` : s
}
