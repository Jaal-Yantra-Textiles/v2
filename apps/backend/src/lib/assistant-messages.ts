/**
 * Bounded normalisation of inbound UI messages.
 *
 * Shared by BOTH assistant surfaces — /partners/assistant/chat and
 * /admin/assistant/chat. The two routes carried a byte-identical copy of this
 * flattening step and an identical absence of any size bound; they live here
 * now so a limit raised for one cannot silently skip the other.
 *
 * Both routes accept a 5 MB body ON PURPOSE: the AI-SDK transport replays the
 * whole thread including tool parts, and a turn that ran a tool with a large
 * result blows straight through Express's 100 kB default. They have to be able
 * to RECEIVE that. What they must not do is carry it.
 *
 * Nothing bounded anything before. `messages` was capped at 60 entries, but a
 * message could hold unlimited parts, each with an unlimited `text`, and the
 * schemas are `.passthrough()` so every unknown key survived too. That payload
 * was then copied several times over on its way to the provider — parsed,
 * zod-cloned, normalised, `convertToModelMessages`'d, folded — so the peak cost
 * of one turn was a multiple of a body size that had no ceiling below 5 MB.
 *
 * So: bound what is RETAINED, not what is received.
 *
 * Distinct from the admin route's `capToolResult`, which bounds a single tool
 * result on the way OUT (64 kB per call). That does nothing about a thread
 * replaying dozens of prior turns back IN, which is this function's job.
 *
 * The limits are deliberately generous. Context compaction is a separate,
 * client-driven mechanism (POST /{partners,admin}/assistant/summarize) and this
 * must not quietly do that job badly — these ceilings sit above any thread a
 * real model context can hold, so they catch runaway and abuse, never a normal
 * conversation. When one does bite, the route logs it rather than silently
 * changing what the user said.
 */

/**
 * Longest single text part we keep. A part beyond this is truncated with a
 * visible marker — the model is told the text was cut rather than being
 * handed a sentence that stops mid-word.
 */
export const MAX_PART_TEXT_CHARS = 100_000

/**
 * Total characters of message text retained across the whole thread.
 * ~600k chars is roughly 150k tokens: comfortably more than any context window
 * this assistant runs against, and ~1.2 MB of UTF-16 rather than an unbounded
 * multiple of the 5 MB body.
 */
export const MAX_TOTAL_TEXT_CHARS = 600_000

export const TRUNCATION_MARKER = "\n\n[… truncated by the server: this message exceeded the per-message size limit]"

export type NormalisedMessage = {
  role: "system" | "user" | "assistant"
  parts: Array<{ type: "text"; text: string }>
}

export type NormaliseResult = {
  messages: NormalisedMessage[]
  /** True when anything was dropped or cut — the caller logs this. */
  bounded: boolean
  /** How many whole messages were dropped from the OLDEST end. */
  droppedMessages: number
  /** How many individual parts were truncated. */
  truncatedParts: number
}

/**
 * Strip everything that isn't text (tool parts, attachments metadata, unknown
 * passthrough keys), then apply the size bounds.
 *
 * Trimming runs OLDEST-FIRST — the newest turns are the ones the model is
 * actually answering, and dropping those to keep stale history would be worse
 * than useless. The most recent message is always kept, truncated if need be,
 * so the function can never return an empty thread.
 */
export function normaliseUiMessages(
  raw: Array<any> | undefined | null
): NormaliseResult {
  const input = Array.isArray(raw) ? raw : []

  // 1. Flatten to text-only parts (the pre-existing behaviour).
  const flattened: NormalisedMessage[] = input.map((m: any) => {
    const parts = Array.isArray(m?.parts) ? m.parts : null
    const textParts = parts
      ? parts
          .filter(
            (p: any) =>
              p?.type === "text" && typeof p.text === "string" && p.text.length > 0
          )
          .map((p: any) => ({ type: "text" as const, text: p.text as string }))
      : [{ type: "text" as const, text: String(m?.content ?? "") }]

    return {
      role: m?.role,
      parts: textParts.length ? textParts : [{ type: "text" as const, text: "" }],
    }
  })

  // 2. Per-part ceiling.
  let truncatedParts = 0
  for (const message of flattened) {
    message.parts = message.parts.map((p) => {
      if (p.text.length <= MAX_PART_TEXT_CHARS) return p
      truncatedParts++
      return {
        type: "text" as const,
        text: p.text.slice(0, MAX_PART_TEXT_CHARS) + TRUNCATION_MARKER,
      }
    })
  }

  // 3. Whole-thread budget, spent newest-first so the oldest turns fall away.
  const sizeOf = (m: NormalisedMessage) =>
    m.parts.reduce((sum, p) => sum + p.text.length, 0)

  let budget = MAX_TOTAL_TEXT_CHARS
  const keptReversed: NormalisedMessage[] = []
  for (let i = flattened.length - 1; i >= 0; i--) {
    const message = flattened[i]
    const cost = sizeOf(message)
    if (cost <= budget) {
      budget -= cost
      keptReversed.push(message)
      continue
    }
    // The newest message alone can exceed the whole budget. Keep it anyway,
    // cut to fit — returning nothing would turn a big turn into a blank one.
    if (keptReversed.length === 0) {
      truncatedParts++
      keptReversed.push({
        role: message.role,
        parts: [
          {
            type: "text" as const,
            text:
              message.parts
                .map((p) => p.text)
                .join("\n")
                .slice(0, MAX_TOTAL_TEXT_CHARS) + TRUNCATION_MARKER,
          },
        ],
      })
      budget = 0
    }
    break
  }

  const messages = keptReversed.reverse()
  const droppedMessages = flattened.length - messages.length

  return {
    messages,
    bounded: droppedMessages > 0 || truncatedParts > 0,
    droppedMessages,
    truncatedParts,
  }
}
