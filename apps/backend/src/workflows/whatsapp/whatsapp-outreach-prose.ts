import { generateText } from "ai"

import { resolveWhatsAppModel } from "./whatsapp-model"
import {
  sanitizeTemplateParam,
  TEMPLATE_PARAM_MAX_LENGTH,
} from "./whatsapp-template-params"

/**
 * Writing the sentence a partner actually reads.
 *
 * The carrier is still a Meta-approved template — nothing here changes that,
 * and nothing here can send an unprompted message on its own. What changes is
 * what goes INTO the template's body variable: a sentence written for this
 * partner and this moment, instead of a fixed string with their name slotted
 * into it.
 *
 * That is the whole point of a prose carrier template: the visual flow adapts
 * by pointing at a different template and letting this write the body, rather
 * than by someone adding a new `vars: [...]` tuple and waiting on a Meta
 * review for every new thing we might want to say.
 *
 * ## What this deliberately does NOT do
 *
 * 🔴 It does not pretend to be a person. The message reads like a human wrote
 * it — warm, specific, no template voice — and that is the goal. But it never
 * claims to BE a named individual, never invents a "team member", and never
 * denies being automated.
 *
 * That is not squeamishness. Partners act on these messages commercially:
 * they accept work, ship goods and invoice against them. A counterparty who
 * believes they are talking to a person makes different commitments than one
 * who knows they are talking to a system, and a message that engineers that
 * belief is a misrepresentation regardless of how friendly it sounds. It is
 * also against WhatsApp's Business Messaging Policy, and the penalty lands on
 * the template — a paused carrier template takes down every message routed
 * through it at once, which with a single prose carrier is all of them.
 *
 * Warm and human-sounding: yes, and that is what the prompt asks for.
 * Pretending to be a human: no.
 *
 * ## Grounding
 *
 * The model is given facts and told not to invent any. A reminder that states
 * a quantity, date or amount that is not true is worse than a rigid one that
 * is merely dull, because the partner will act on it.
 */

export type OutreachFacts = {
  /** Who we are addressing. Used as-is; never re-spelled by the model. */
  partner_name: string
  /** The business sending it. Always OUR identity, never a person's. */
  business_name: string
  /** Why we are reaching out, in plain words — the caller's own summary. */
  purpose: string
  /** Facts the sentence may use. Anything not here must not appear. */
  details?: Record<string, string | number | null | undefined>
  /** "hinglish" | "english" | "devanagari" — matched to how they write. */
  language?: string
}

/** Used whenever no model is reachable. Plain, honest, and always available. */
export function fallbackOutreachText(facts: OutreachFacts): string {
  const bits = [
    `Hi ${facts.partner_name}, this is ${facts.business_name} on WhatsApp.`,
    facts.purpose,
  ].filter(Boolean)
  return sanitizeTemplateParam(bits.join(" ")).text
}

const LANGUAGE_NOTE: Record<string, string> = {
  hinglish:
    "Write in Hinglish (Hindi written in Latin script, mixed with English) — the way people actually message on WhatsApp in India.",
  devanagari: "Write in Hindi, in Devanagari script.",
  english: "Write in simple, plain English.",
}

export function buildOutreachPrompt(facts: OutreachFacts): string {
  const details = Object.entries(facts.details ?? {})
    .filter(([, v]) => v !== null && v !== undefined && String(v).trim() !== "")
    .map(([k, v]) => `- ${k}: ${v}`)
    .join("\n")

  const languageNote =
    LANGUAGE_NOTE[(facts.language ?? "").toLowerCase()] ?? LANGUAGE_NOTE.english

  return [
    `You are writing one short WhatsApp message on behalf of ${facts.business_name}, a textile business, to a manufacturing partner.`,
    "",
    `Partner name: ${facts.partner_name}`,
    `Why we are messaging: ${facts.purpose}`,
    details ? `Facts you may use:\n${details}` : "Facts you may use: none beyond the above.",
    "",
    languageNote,
    "",
    "Rules:",
    "- Write like a person would: warm, direct, specific. No template voice, no 'Dear Sir/Madam', no bullet points, no markdown.",
    "- ONE short paragraph. Two or three sentences. This is a WhatsApp message, not an email.",
    "- Use ONLY the facts given above. Do not invent quantities, dates, prices, order numbers or names. If you do not have a fact, leave it out.",
    `- You are ${facts.business_name}. Do NOT claim to be a named individual person, do not sign off with a personal name, and do not invent a staff member.`,
    "- Do not promise anything we have not stated — no delivery dates, no payment dates, no rates.",
    "- Plain text only. No line breaks, no tabs, no emoji-only lines.",
    "- End in a way that invites a reply.",
    "",
    "Write only the message text. No preamble, no quotes around it.",
  ].join("\n")
}

/**
 * Compose the body text for a prose carrier template.
 *
 * Always returns something sendable. A model that is missing, slow or wrong
 * must not stop a partner being contacted, so every failure path lands on
 * `fallbackOutreachText` — the degraded message is plain, not absent.
 */
export async function composeOutreachText(
  scope: any,
  facts: OutreachFacts
): Promise<{ text: string; source: "model" | "fallback"; reason?: string }> {
  let model: any
  try {
    model = await resolveWhatsAppModel(scope)
  } catch (e: any) {
    return {
      text: fallbackOutreachText(facts),
      source: "fallback",
      reason: `model_unavailable: ${e?.message ?? "unknown"}`,
    }
  }

  if (!model?.model) {
    return { text: fallbackOutreachText(facts), source: "fallback", reason: "no_model" }
  }

  try {
    const { text } = await generateText({
      model: model.model,
      prompt: buildOutreachPrompt(facts),
      // A WhatsApp line. The cap is a guard against a model that will not stop,
      // not a target — the prompt already asks for two or three sentences.
      maxOutputTokens: 300,
      temperature: 0.7,
    })

    const cleaned = sanitizeTemplateParam(text, TEMPLATE_PARAM_MAX_LENGTH)
    if (!cleaned.text || cleaned.text === "—") {
      return { text: fallbackOutreachText(facts), source: "fallback", reason: "empty_model_output" }
    }
    return { text: cleaned.text, source: "model" }
  } catch (e: any) {
    return {
      text: fallbackOutreachText(facts),
      source: "fallback",
      reason: `generate_failed: ${e?.message ?? "unknown"}`,
    }
  }
}
