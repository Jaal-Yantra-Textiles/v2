/**
 * Pure prompt/formatting helpers for the free-form WhatsApp partner chat.
 *
 * Kept dependency-free (no AI SDK, no Medusa container) so they unit-test in
 * isolation and so the orchestration module (`whatsapp-freeform-chat.ts`) stays
 * about wiring: resolving the model, packing context, and sending. Everything
 * here turns structured data into the exact strings the LLM prompt is built
 * from.
 */

export const FREEFORM_FEATURE = "whatsapp/freeform_partner_chat"
export const FREEFORM_ROLE = "ai_whatsapp_partner_chat"

/**
 * The name the assistant introduces itself with. Override per environment —
 * this is the "SS from JYT" in the opening line.
 */
const FREEFORM_AGENT_NAME = process.env.WHATSAPP_FREEFORM_AGENT_NAME || "SS"

/**
 * The real person a partner is put through to.
 *
 * 🔴 Why this is a SEPARATE name from `FREEFORM_AGENT_NAME`.
 *
 * Partners ask "who is this?" and "where are you?" — and until now nothing in
 * this prompt answered either, so the model improvised around the initials
 * "SS". An invented persona is the worst of the three options: it is neither
 * the truth nor a real contact, and it varies between replies.
 *
 * The answer names BOTH: the business the partner is dealing with, and the
 * human who stands behind the work. What it must never do is collapse the two
 * — the assistant does not claim to BE this person.
 *
 * That is not squeamishness. Partners act on these messages commercially: they
 * accept work, ship goods and invoice against them. Someone who believes they
 * are talking to the founder makes different commitments than someone who
 * knows they are talking to his assistant, and a reply engineering that belief
 * is a misrepresentation however friendly it sounds. It is also against
 * WhatsApp's Business Messaging Policy, where the penalty lands on the
 * account rather than the message.
 *
 * Naming a real contact is the opposite of hiding behind a bot: it gives the
 * partner a person to hold to account, which is what they were asking for.
 */
const TEAM_CONTACT_NAME = process.env.WHATSAPP_TEAM_CONTACT_NAME || "Saransh"

/** Where we are, for the other half of "who and where are you?". */
const BUSINESS_LOCATION = process.env.WHATSAPP_BUSINESS_LOCATION || "India"

/** True when the free-form chat service is switched on for this environment. */
export function isFreeformChatEnabled(): boolean {
  const v = (process.env.WHATSAPP_FREEFORM_CHAT_ENABLED || "").trim().toLowerCase()
  return v === "1" || v === "true" || v === "yes" || v === "on"
}

// ── Types ─────────────────────────────────────────────────────────────────

export type PartnerChatContext = {
  designs: Array<{
    id: string
    name: string
    status: string
    product_type?: string | null
    target_completion_date?: string | null
  }>
  openRuns: Array<{
    id: string
    status: string
    accepted: boolean
    designName?: string
  }>
  pendingPayments: Array<{
    id: string
    status: string
    totalAmount?: number | null
    currency?: string | null
  }>
}

export type HistoryEntry = {
  role: "partner" | "bot"
  content: string
}

// ── Formatting ────────────────────────────────────────────────────────────

/**
 * Render the live context block the system prompt injects. Compact on purpose —
 * this is a system prompt, not a report; the model is told to answer from it
 * rather than restate it.
 */
export function formatPartnerContext(ctx: PartnerChatContext): string {
  const lines: string[] = []

  if (ctx.designs?.length) {
    lines.push("Designs:")
    for (const d of ctx.designs) {
      const due = d.target_completion_date ? `, due ${d.target_completion_date}` : ""
      const type = d.product_type ? `, type: ${d.product_type}` : ""
      lines.push(`- ${d.name} [${d.id}] — status: ${d.status}${type}${due}`)
    }
  } else {
    lines.push("Designs: none on record.")
  }

  if (ctx.openRuns?.length) {
    lines.push("Production runs:")
    for (const r of ctx.openRuns) {
      const design = r.designName ? ` (${r.designName})` : ""
      const state = r.accepted ? "accepted" : "awaiting acceptance"
      lines.push(`- ${r.id}${design} — status: ${r.status}, ${state}`)
    }
  } else {
    lines.push("Production runs: none currently open.")
  }

  if (ctx.pendingPayments?.length) {
    lines.push("Pending payments:")
    for (const p of ctx.pendingPayments) {
      const amt =
        p.totalAmount != null
          ? `, ${p.currency ?? "₹"} ${Number(p.totalAmount).toLocaleString("en-IN")}`
          : ""
      lines.push(`- ${p.id} — status: ${p.status}${amt}`)
    }
  }

  return lines.length ? lines.join("\n") : "(no open work on record)"
}

/**
 * Render the recent conversation transcript (partner + bot turns) for the
 * user prompt. "You" is the assistant; "Partner" is the human on the other end.
 */
export function formatConversationHistory(entries: HistoryEntry[]): string {
  if (!entries.length) return "(no prior messages)"
  return entries
    .map((e) => `${e.role === "partner" ? "Partner" : "You"}: ${e.content}`)
    .join("\n")
}

/**
 * The persona + live context. This is the "system" half of the prompt; the
 * incoming message + transcript ride in the user half.
 *
 * `language` is the model-evaluated script (`hinglish` | `english` |
 * `devanagari`) from `whatsapp-intent.ts`, or the onboarding "hi" flag. The
 * regex-based `detectPartnerLanguage` is gone — language is a judgment now,
 * not a parse.
 */
export function buildFreeformSystemPrompt(opts: {
  agentName?: string
  /** Overrides the real human contact named in replies. Defaults to env. */
  contactName?: string
  /** Overrides where we say we are based. Defaults to env. */
  businessLocation?: string
  partnerName: string
  language?: string
  contextText: string
}): string {
  const agentName = opts.agentName || FREEFORM_AGENT_NAME
  const contactName = opts.contactName || TEAM_CONTACT_NAME
  const businessLocation = opts.businessLocation || BUSINESS_LOCATION
  const languageRule =
    opts.language === "devanagari"
      ? "The partner is writing in Hindi (Devanagari script). Reply in Devanagari Hindi."
      : opts.language === "english"
        ? "The partner is writing in English. Reply in English."
        : opts.language === "hi"
          ? "The partner chose Hindi. Reply in Hinglish — Hindi written in Roman letters (e.g. \"theek hai\", \"kal tak ho jayega\"). Do not discuss which script to use; just reply naturally."
          : "Reply in Hinglish — Hindi written in Roman letters (e.g. \"theek hai\", \"kal tak ho jayega\") — by default, because that is how most partners type. If the partner writes plain English, reply in English; if they write in Devanagari script, mirror Devanagari. Do not discuss which script to use; just reply naturally."

  return `You are ${agentName}, a friendly production-coordination assistant at Jaal Yantra Textiles (JYT). You are chatting with ${opts.partnerName}, one of our manufacturing partners, over WhatsApp.

# How to talk
- Sound like a person, not a bot. Keep replies SHORT — one to three sentences. This is WhatsApp, not email.
- Answer questions about their production runs, designs and payments from the LIVE CONTEXT below or from your lookup tools. Never invent a status, quantity, date, design, amount or a name for the partner. The partner's name is ${opts.partnerName} — use that, never a different one. If you genuinely don't know something, say so and offer to have the team check.
- When the partner tells you something about a run or design ("getting ready", "done", "will finish tomorrow"), acknowledge it naturally and confirm the team will note it. You are NOT changing any system record yourself.
- Ask at most ONE follow-up question when it genuinely moves the work along — for example asking for a progress photo, a completion estimate, or a scrap count. Don't interrogate.
- A bare acknowledgment ("ok", "haan", "theek hai", "👍") needs NO follow-up question — reply with one short, warm line and stop.
- Use plain text. You may use *asterisks* for light emphasis. No headings, no bullet lists, no links, no emoji spam.

# Language
- ${languageRule}

# Who you are, when they ask
- Partners do ask "who is this?", "are you a real person?", "where are you?". Answer plainly, in one short line. Never dodge it and never invent a surname, a role or an office.
- You are ${agentName}, the production assistant at Jaal Yantra Textiles. ${contactName} is the person here who looks after their work, and you pass things on to ${contactName} and the team. We are based in ${businessLocation}.
- If they ask directly whether you are a person, say plainly that you are an assistant working with ${contactName} — do not claim to be ${contactName}, and do not sign off as ${contactName}. Say it lightly and carry on with their question; it is not a confession.
- Never claim to be a human, and never invent a colleague who does not exist.

# Guardrails — never break these
- NEVER tell the partner to scrap, reject, discard or throw away any pieces. You have no authority to do that, and Hinglish "bache hain" means *remaining*, not scrap. If they mention defects or scrap, just acknowledge and say the team will review.
- NEVER state that a run or design has moved status unless the context or a tool tells you so. Status moves happen through the partner's own actions, not your words.

# Nudging status forward
- If a run is stuck — awaiting acceptance, sent but not started, or started but not finished — and the partner is vague or quiet, give ONE gentle nudge on how to move it: they can reply here with *accept prod_run_…*, *start prod_run_…*, *finish prod_run_…* or *complete prod_run_…*, or do it in their portal. Name the specific run id from the context when you do. Do not nag — one reminder per run is enough.

# Photos
- If the partner says they are sending (or have sent) a photo and it is not clear which design or run it is for, ask which one — and offer the likely candidates from their open work ("Is this for the Indigo Block Kurta or the Pashmina Stole?"). Never guess and attach it yourself.

# Live context (as of now)
${opts.contextText}`
}

/**
 * The user half: the recent transcript plus what the partner just wrote, and
 * a nudge to actually produce a short reply.
 */
export function buildUserPrompt(opts: {
  historyText: string
  partnerName: string
  incomingText: string
}): string {
  return [
    "Conversation so far:",
    opts.historyText,
    "",
    `${opts.partnerName} just wrote:`,
    opts.incomingText,
    "",
    "Write your reply now (one to three sentences, plain text).",
  ].join("\n")
}