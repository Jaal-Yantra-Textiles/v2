import { composeOutreachText, type OutreachFacts } from "./whatsapp-outreach-prose"

/**
 * #2122 / #2130 — a reminder that reads like a person wrote it.
 *
 * What a partner gets today is a fixed template with their details slotted in:
 *
 *     Sharlho · Alpha 60 Top · prod_run_01M25XAZZM8BEKDSPHK5MT11G7 · 1 · 1
 *
 * The same shape every morning, for every run, for months. Sharlho received
 * 235 of them and replied twelve times in five months. A message that looks
 * identical to the last forty is a message that has stopped being read, and a
 * reminder nobody reads is not a reminder — it is noise that still costs us a
 * template send and still burns the cap.
 *
 * This writes the sentence instead. Same facts, same carrier template, same
 * approval — what changes is the one free-text variable inside it.
 *
 * ## Same rules as first contact
 *
 * It reuses `composeOutreachText`, so it inherits all of its guarantees: the
 * output is sanitised for Meta's parameter rules (no newlines, no tabs, length
 * capped), the model is told to invent nothing, and it never claims to be a
 * person. See that file's docblock — the reasoning about misrepresentation
 * applies with more force here, not less: a reminder asks a partner to act.
 *
 * ## And it always returns something
 *
 * A reminder that fails to compose must still go out. Every failure path in
 * `composeOutreachText` lands on a plain fallback sentence, so the worst case
 * is a dull reminder, never a missing one.
 */

/** The stage a run is in, in the words a person would use about it. */
const PURPOSE_BY_KIND: Record<string, string> = {
  assignment_pending:
    "we sent them this production run a while ago and they have not accepted it yet — we would like to know if they can take it on",
  not_started:
    "they accepted this production run but work has not started yet — we would like to know when they expect to begin",
  idle: "this production run has been in progress for a while with no update — we would like to know how it is going",
  awaiting_reassignment:
    "this production run is currently unassigned and waiting for someone to pick it up",
}

export type ReminderFacts = {
  partner_name: string
  business_name: string
  reminder_kind: string
  design_name?: string | null
  run_id?: string | null
  quantity?: number | string | null
  /** How long it has been sitting, already in human form ("6 days"). */
  age_label?: string | null
  /**
   * How many times we have already asked. The sentence should acknowledge a
   * repeat rather than pretend it is the first — a partner who has been asked
   * twice and gets a cheerful opener reads it as a machine, which it is, but
   * an unobservant one.
   */
  reminder_count?: number | null
  /** "hi" | "en" … — the language the partner chose at REGISTRATION (#2130). */
  language_code?: string | null
}

/**
 * Map a stored WhatsApp language code onto the style note the prose prompt
 * understands.
 *
 * 🔴 `hi` becomes **hinglish**, not `devanagari`. The partners on this channel
 * write to us in Latin script far more often than in Devanagari — Sharlho's own
 * inbound messages are "Ok", "Accept", "I Agree" alongside "हिंदी" — and a wall
 * of Devanagari is harder to skim on a phone for someone who types Hinglish.
 * A partner who genuinely wants Devanagari is a preference we do not currently
 * record separately; when we do, it maps here.
 */
export function proseLanguageFor(languageCode?: string | null): string {
  const code = (languageCode ?? "").trim().toLowerCase()
  if (code === "hi" || code.startsWith("hi-")) return "hinglish"
  if (code === "hi_deva" || code === "hi-deva") return "devanagari"
  return "english"
}

/**
 * Turn reminder facts into the `OutreachFacts` the prose composer takes.
 * Pure and exported so the prompt inputs can be asserted without a model.
 */
export function buildReminderFacts(facts: ReminderFacts): OutreachFacts {
  const purpose =
    PURPOSE_BY_KIND[facts.reminder_kind] ??
    "we are following up on this production run and would like an update"

  const details: Record<string, string | number | null | undefined> = {
    design: facts.design_name ?? undefined,
    quantity: facts.quantity ?? undefined,
    "how long it has been waiting": facts.age_label ?? undefined,
  }

  // Only mention a repeat when it IS one. `reminder_count` is the count of
  // reminders already sent, so 0 or 1 is the first ask.
  if ((facts.reminder_count ?? 0) >= 1) {
    details["times we have already asked"] = facts.reminder_count as number
  }

  // The run id is deliberately NOT a detail. It is a machine identifier that
  // means nothing to the person reading it, and the old templates put it in
  // every message — which is a large part of why they read like receipts.
  // The deep link in the template's button is how a partner reaches the run.

  return {
    partner_name: facts.partner_name,
    business_name: facts.business_name,
    purpose,
    details,
    language: proseLanguageFor(facts.language_code),
  }
}

/**
 * Compose the reminder sentence. Never throws; always returns sendable text.
 */
export async function composeReminderText(
  scope: any,
  facts: ReminderFacts
): Promise<{ text: string; source: "model" | "fallback"; reason?: string }> {
  return composeOutreachText(scope, buildReminderFacts(facts))
}
