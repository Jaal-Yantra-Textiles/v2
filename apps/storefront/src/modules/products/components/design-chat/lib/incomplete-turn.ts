/**
 * Abandoned tool calls — the shape of a turn that stopped without saying so.
 *
 * The provider can end a turn while a tool call's argument JSON is still
 * streaming. The AI SDK then never fires `tool-input-available`, so the tool
 * never runs and its UI part is stuck at `input-streaming` for the rest of the
 * session: a chip that spins forever, with no error and nothing to retry.
 *
 * The silence is the dangerous part. The assistant's prose is written from its
 * INTENT, not from what actually happened, so a turn whose `save_brief` was
 * abandoned still opens with "Brief locked". Measured on production (#1725):
 * one turn ended `finishReason: "tool-calls"` with zero executed calls, and
 * another was cut mid-word with no `finish` part at all — neither reached the
 * `error` channel, so `useChat` reported both as ordinary completions.
 *
 * A turn is over once the chat leaves its streaming states. Anything still
 * pending at that moment did not happen.
 */

export const INCOMPLETE_TOOL_ERROR =
  "This step was cut short and never ran — please send your message again."

/**
 * A tool part the model announced but never finished handing arguments to.
 *
 * `input-available` counts as pending too: the arguments are complete but no
 * result came back, so the tool still may not have run.
 */
export const isPendingToolPart = (p: any): boolean =>
  typeof p?.type === "string" &&
  p.type.startsWith("tool-") &&
  (p.state === "input-streaming" || p.state === "input-available")

export const countPendingToolParts = (m: any): number =>
  ((m?.parts ?? []) as any[]).filter(isPendingToolPart).length

/**
 * Rewrite every pending tool part to `output-error`.
 *
 * `output-error` is not a new state — every chip in message-parts.tsx already
 * renders it. Sealing just tells them the truth.
 */
export const sealPendingToolParts = <T,>(m: T): T => {
  const anyMsg = m as any
  if (!countPendingToolParts(anyMsg)) return m
  return {
    ...anyMsg,
    parts: ((anyMsg.parts ?? []) as any[]).map((p) =>
      isPendingToolPart(p)
        ? { ...p, state: "output-error", errorText: INCOMPLETE_TOOL_ERROR }
        : p
    ),
  }
}

/**
 * A reply that claims a design was saved when nothing was (#2556).
 *
 * Measured on prod (2026-11-19): asked for "the matching trousers", the model
 * wrote "Design created ✅ Design ID 01M7RRB2…" three turns running without
 * calling a tool, and that id never existed. Unlike a cut-short turn there is
 * no pending tool part to see — only prose. So read the prose:
 *
 *   - a design id written next to the word "design" that no tool returned and
 *     no tab holds, or
 *   - "design created" in a reply where no design tool ran.
 *
 * Ids are matched only beside "design", because fabric and partner ids share
 * the same 26-character shape.
 */
const DESIGN_ID_CLAIM_RE = /design[^\n]{0,40}?\b(01[0-9A-HJKMNP-TV-Z]{24})\b/gi
const CREATED_CLAIM_RE = /\bdesign (?:record )?(?:created|started|saved)\b/i
const DESIGN_TOOLS = new Set(["tool-create_design", "tool-start_new_design"])

export const claimsUnsavedDesign = (m: any, knownDesignIds: Iterable<string>): boolean => {
  if (m?.role !== "assistant") return false
  const parts = ((m?.parts ?? []) as any[])
  const known = new Set(knownDesignIds)
  let designToolRan = false
  for (const p of parts) {
    if (typeof p?.type === "string" && p.type.startsWith("tool-") && p.output?.design_id) {
      known.add(String(p.output.design_id))
    }
    if (DESIGN_TOOLS.has(p?.type) && p?.state === "output-available") designToolRan = true
  }
  const text = parts
    .filter((p) => p?.type === "text" && typeof p.text === "string")
    .map((p) => p.text)
    .join("\n")
  const claimedIds = Array.from(text.matchAll(DESIGN_ID_CLAIM_RE), (match) => match[1].toUpperCase())
  if (claimedIds.some((id) => !known.has(id))) return true
  return !designToolRan && CREATED_CLAIM_RE.test(text)
}
