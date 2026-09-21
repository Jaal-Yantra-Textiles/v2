import { isLineUsable } from "./whatsapp-line-prompt"

/**
 * Natural-language wording for the run-lifecycle acknowledgements.
 *
 * What a partner got until now was a constant:
 *
 *     ✅ *Run Accepted:* prod_run_01M22YXTZKQXBSD23MZAQBVRTE
 *     *Design:* Pashmina Inspired Tunic
 *     You can now start working on this run.
 *
 * English whatever language they chose, and written at them rather than to
 * them. This module builds the prompt that turns the same FACTS into a
 * sentence, and — more importantly — decides whether the sentence that comes
 * back is safe to send.
 *
 * Pure on purpose, split from the module that calls the model, matching
 * `whatsapp-freeform-prompt.ts`: the rules below are the part worth testing
 * and they test without dragging in the AI SDK.
 *
 * ## What the model is NOT allowed to do
 *
 * 🔴 It never writes an identifier. Run ids, quantities and design names are
 * appended by code or checked against the facts, because a model that
 * invents `prod_run_01M22…` one character off produces a message that looks
 * right, refers to nothing, and is indistinguishable from a real one. The
 * same reasoning already keeps write tools out of the free-form chat: a model
 * must not be the thing that moves a run, and it must not be the thing that
 * NAMES one either.
 *
 * 🔴 It never writes the buttons. Those are the action surface; they stay
 * deterministic.
 */

/** Ships dark. Separate from the free-form chat flag — this one replies to every partner, not just chatty ones. */
export function isNaturalRunAcksEnabled(): boolean {
  const v = (process.env.WHATSAPP_NATURAL_RUN_ACKS_ENABLED || "")
    .trim()
    .toLowerCase()
  return v === "1" || v === "true" || v === "yes" || v === "on"
}

export type RunAckIntent =
  | "accepted"
  | "started"
  | "finished"
  | "completed"
  | "declined"

export type RunAckFacts = {
  runId: string
  designName?: string | null
  quantity?: number | null
  /** Only on `completed`. */
  producedQuantity?: number | null
  /** Only on `declined`, already humanised ("out of capacity"). */
  reason?: string | null
}

/** What each acknowledgement has to get across, in the platform's own words. */
const INTENT_BRIEF: Record<RunAckIntent, string> = {
  accepted:
    "They just accepted this job. Confirm we have it, and tell them the next thing they do is start it when they are ready.",
  started:
    "They just marked the job started. Confirm it, and tell them to mark it finished when the work is done.",
  finished:
    "They just marked the job finished. Confirm it, and tell them the last step is to complete it with the final numbers.",
  completed:
    "The job is complete and the admin has been told. Thank them.",
  declined:
    "They declined this job. Acknowledge it without pressure and tell them the admin has been notified.",
}

const LANGUAGE_NAME: Record<string, string> = {
  en: "English",
  hi: "Hindi",
}

export function buildRunAckSystemPrompt(language: string): string {
  const name = LANGUAGE_NAME[language] || "English"
  return [
    `You write one short WhatsApp message to a textile production partner, in ${name}.`,
    "",
    "Rules:",
    `- Write in ${name}. Do not translate proper nouns such as the design name.`,
    "- One or two sentences. No greeting, no sign-off, no emoji.",
    "- Speak to them, not about them. Warm, plain, practical.",
    "- State only what the facts say. Never invent a date, a price or a status.",
    "- NEVER write an identifier, code or number that is not given in the facts.",
    "- Do not add questions. Do not offer to help further.",
    "- Return the message text only.",
  ].join("\n")
}

export function buildRunAckUserPrompt(opts: {
  intent: RunAckIntent
  facts: RunAckFacts
}): string {
  const { intent, facts } = opts
  const lines = [`What happened: ${INTENT_BRIEF[intent]}`, "", "Facts:"]
  if (facts.designName) lines.push(`- Design: ${facts.designName}`)
  if (typeof facts.quantity === "number") {
    lines.push(`- Quantity ordered: ${facts.quantity}`)
  }
  if (typeof facts.producedQuantity === "number") {
    lines.push(`- Quantity produced: ${facts.producedQuantity}`)
  }
  if (facts.reason) lines.push(`- Reason given: ${facts.reason}`)
  /*
   * The run id is deliberately WITHHELD from the model. The caller appends it
   * verbatim, so there is no path by which a hallucinated id reaches a
   * partner — and no need to check for one afterwards.
   */
  lines.push("", "Write the message.")
  return lines.join("\n")
}

/**
 * Longest we will send. Re-exported from the shared rules (#2216) so the two
 * paths cannot drift apart on what "too long" means.
 */
export { LINE_MAX_CHARS as RUN_ACK_MAX_CHARS } from "./whatsapp-line-prompt"

/**
 * PURE: is this reply safe to send to a partner?
 *
 * Fails CLOSED — anything odd returns false and the caller sends the constant
 * it already had. A partner getting the old robotic line is a small loss; a
 * partner getting an empty message, a wall of text, or a sentence containing
 * a fabricated code is a real one.
 *
 * 🔴 The checks themselves now live in `whatsapp-line-prompt.ts` and are
 * shared with every other generated reply (#2216). They were duplicated for
 * one release and that was one release too many: two regexes that are meant to
 * agree about what an identifier looks like eventually disagree, and the
 * failure mode of that disagreement is an invented `prod_run_…` reaching a
 * partner. The numbers a run ack may reuse are still decided HERE, because
 * they come from the run's own quantities and nowhere else.
 */
export function isRunAckUsable(
  text: unknown,
  facts: RunAckFacts
): text is string {
  return isLineUsable(
    text,
    [facts.quantity, facts.producedQuantity].filter(
      (n): n is number => typeof n === "number"
    )
  )
}

/**
 * The message actually sent: the model's sentence, then the identifiers, added
 * by code so they cannot be wrong.
 */
export function composeRunAck(
  sentence: string,
  facts: RunAckFacts
): string {
  const tail = [
    facts.designName ? `*Design:* ${facts.designName}` : null,
    `*Run:* ${facts.runId}`,
  ]
    .filter(Boolean)
    .join("\n")
  return `${sentence.trim()}\n\n${tail}`
}
