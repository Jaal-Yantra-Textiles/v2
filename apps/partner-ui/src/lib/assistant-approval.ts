/**
 * Approval hand-back for the partner assistant's sensitive-tool cards.
 *
 * A sensitive tool comes back as `requires_confirmation` and is then run
 * CLIENT-SIDE, straight against POST /partners/mcp (see ./assistant-mcp) — the
 * model is not involved in that call and never learns it happened. The chat
 * route also strips tool parts from history and sends the model text only, so
 * patching the tool part's output is not enough on its own: without a text
 * hand-back the model's last words ("…please confirm you want me to proceed")
 * stand as its answer to an approval that already went through.
 *
 * So resolving a card does two things:
 *   1. `resolveToolPart` writes the real result into the message (which is what
 *      gets persisted — a reopened chat must never re-offer an action that has
 *      already run) and drops the prose the model wrote after the card, which
 *      was written on the assumption that nothing had run yet;
 *   2. `approvalNote` gives the model the outcome as an ordinary user turn, so
 *      its next words describe what happened rather than what it planned.
 */

/** Marks the turn that carries an approved tool's result back to the model. */
export const APPROVAL_NOTE_PREFIX = "[approved-tool-result]"

/** Result payloads can be large (a product with nine variants); the model only
 *  needs enough of one to describe what happened. */
const APPROVAL_NOTE_MAX_CHARS = 2000

export function approvalNote(name: string, result: unknown): string {
  let json: string
  try {
    json = JSON.stringify(result) ?? "null"
  } catch {
    json = "{}"
  }
  if (json.length > APPROVAL_NOTE_MAX_CHARS) {
    json = `${json.slice(0, APPROVAL_NOTE_MAX_CHARS)}… (truncated)`
  }
  return (
    `${APPROVAL_NOTE_PREFIX} I approved \`${name}\` in the UI and it has ALREADY RUN. ` +
    `Its result:\n${json}\n` +
    `Do not ask for confirmation again and do not call it again — tell me what actually happened, based on this result.`
  )
}

/** The tool name carried by an approval-note turn, or null if it isn't one. */
export function approvalNoteTool(text: string): string | null {
  if (!text.startsWith(APPROVAL_NOTE_PREFIX)) return null
  return text.match(/`([^`]+)`/)?.[1] ?? "the action"
}

type Part = { type?: string; toolCallId?: string; [k: string]: unknown }

/**
 * Replace a tool call's output with the outcome of the user's decision.
 *
 * On approval the prose that follows the card is dropped — it asked for a
 * confirmation that has since been given, so leaving it reads as the assistant
 * ignoring the button the user just pressed. Prose BEFORE the card stays (it
 * explains the action), and anything from a later tool call onwards stays too:
 * that belongs to a different action.
 *
 * Returns the original array when the call isn't in it, so callers can map over
 * a message list without special-casing.
 */
export function resolveToolPart(
  parts: Part[],
  toolCallId: string,
  result: unknown,
  action: "approved" | "rejected"
): Part[] {
  if (!Array.isArray(parts)) return parts
  const idx = parts.findIndex((p) => p?.toolCallId === toolCallId)
  if (idx === -1) return parts

  const next: Part[] = parts.slice(0, idx)
  next.push({ ...parts[idx], output: result, state: "output-available" })

  for (let i = idx + 1; i < parts.length; i++) {
    const p = parts[i]
    const isProse = p?.type === "text" || p?.type === "reasoning"
    if (action === "approved" && isProse) continue
    // A later tool call ends the stale region — keep it and everything after.
    next.push(...parts.slice(i))
    break
  }
  return next
}
