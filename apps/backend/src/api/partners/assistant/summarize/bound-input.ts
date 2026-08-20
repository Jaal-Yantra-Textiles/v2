/**
 * Bound the text handed to the summarizer.
 *
 * The summarize endpoint exists to SHRINK a conversation, but its client was
 * observed POSTing a 2.38 MB body (prod, 2026-08-20) — the very context blow-up
 * it is meant to prevent. Unbounded, that either exceeds the model's context
 * window (→ error → 502) or costs far more than a 4-8 bullet summary should.
 *
 * The strategy preserves the two ends that matter and drops the middle:
 *   - the FIRST turn is always kept — it usually carries the anchoring context
 *     (store id, who the partner is, the task), and losing it is what makes the
 *     assistant "forget the store id" after a compaction;
 *   - the most RECENT turns are kept up to a total budget;
 *   - anything in between is replaced by a single "[N earlier turns omitted]"
 *     marker so the model knows the history is not continuous.
 *
 * Each message's text is also capped on its own, so one pathological turn (a
 * giant tool result pasted as text) cannot consume the whole budget.
 */

export type SummaryMessage = {
  role: "system" | "user" | "assistant"
  parts: Array<{ type: "text"; text: string }>
}

// A single turn longer than this is truncated with a marker. Generous enough
// for real prose, small enough that one giant paste can't dominate.
export const MAX_MSG_CHARS = 4000
// Whole-input budget (~6k tokens). Deliberately conservative so it fits even a
// small-context model — the assistant can be pointed at a Cloudflare Workers AI
// model (e.g. @cf/meta/llama-3.1-8b-instruct), and a summariser needs to capture
// decisions, not re-read the transcript verbatim.
export const MAX_TOTAL_CHARS = 24000

const flattenText = (m: SummaryMessage): string =>
  (m.parts || [])
    .map((p) => (typeof p?.text === "string" ? p.text : ""))
    .filter(Boolean)
    .join("\n")

const truncate = (text: string): string =>
  text.length > MAX_MSG_CHARS
    ? `${text.slice(0, MAX_MSG_CHARS)}\n…[${
        text.length - MAX_MSG_CHARS
      } chars truncated]`
    : text

const wrap = (role: SummaryMessage["role"], text: string): SummaryMessage => ({
  role,
  parts: [{ type: "text", text }],
})

/**
 * Render the bounded turns into a flat transcript.
 *
 * Summarize must NOT hand the turns to the model as a live chat: a chat model
 * answers the last user turn and CONTINUES the conversation instead of
 * summarizing it (observed live on prod — the model replied "what HS code?"
 * rather than producing a summary). Collapsing to a single transcript, wrapped
 * by an instruction, leaves no dangling turn to answer.
 */
export const renderTranscript = (messages: SummaryMessage[]): string =>
  messages
    .map((m) => {
      const who =
        m.role === "assistant"
          ? "ASSISTANT"
          : m.role === "system"
          ? "NOTE"
          : "USER"
      const text = (m.parts || [])
        .map((p) => p.text)
        .filter(Boolean)
        .join("\n")
      return `${who}: ${text}`
    })
    .join("\n\n")

export const boundSummaryInput = (
  messages: SummaryMessage[]
): SummaryMessage[] => {
  const trimmed = messages.map((m) => ({
    role: m.role,
    text: truncate(flattenText(m)),
  }))

  const grandTotal = trimmed.reduce((s, m) => s + m.text.length, 0)
  if (grandTotal <= MAX_TOTAL_CHARS) {
    return trimmed.map((m) => wrap(m.role, m.text))
  }

  // Over budget: keep the first turn (the context anchor) + as many of the most
  // recent turns as fit, and note the gap between them.
  const first = trimmed[0]
  let total = first.text.length
  const recentReversed: typeof trimmed = []
  for (let i = trimmed.length - 1; i >= 1; i--) {
    const len = trimmed[i].text.length
    if (total + len > MAX_TOTAL_CHARS) {
      break
    }
    total += len
    recentReversed.push(trimmed[i])
  }
  const recent = recentReversed.reverse()

  // omitted = everything except the first turn and the kept recent ones.
  const omitted = messages.length - 1 - recent.length
  const out: SummaryMessage[] = [wrap(first.role, first.text)]
  if (omitted > 0) {
    out.push(
      wrap(
        "user",
        `[${omitted} earlier turn(s) omitted to fit the summary budget — summarize from the surrounding turns and mark anything uncertain as "unclear".]`
      )
    )
  }
  for (const m of recent) {
    out.push(wrap(m.role, m.text))
  }
  return out
}
