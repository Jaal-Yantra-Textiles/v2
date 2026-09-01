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
