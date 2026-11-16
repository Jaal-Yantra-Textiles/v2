/**
 * Which board-mutating tool results are NEW since the last pass (#2543).
 *
 * The design studio runs this on every `messages` change, and messages change
 * on every streamed chunk. Without the `handled` set, any earlier completed
 * tool re-fired a board refresh per chunk: ~3 GET /designs/:id a second for
 * the rest of the session (seen live on prod, 2026-11-16).
 */

const DESIGN_MINTING_TOOLS = new Set(["tool-create_design", "tool-generate_design_image"])
const BOARD_TOOLS = new Set([
  "tool-generate_design_image",
  "tool-save_moodboard",
  "tool-create_design",
])

type MessageLike = { id?: string; role?: string; parts?: unknown[] }

export type BoardToolEvents = {
  /** Latest design id handed back by create_design / generate_design_image. */
  createdId: string | null
  /** Its design access token, when the tool returned one. */
  createdToken: string | null
  /** True only if a board tool completed since the last call. */
  shouldRefresh: boolean
}

/** Mutates `handled`: each completed tool call refreshes the board once. */
export function collectBoardToolEvents(
  messages: MessageLike[],
  handled: Set<string>
): BoardToolEvents {
  let createdId: string | null = null
  let createdToken: string | null = null
  let shouldRefresh = false

  for (const m of messages) {
    if (m.role !== "assistant") continue
    for (const raw of (m.parts ?? []) as any[]) {
      if (raw?.state !== "output-available") continue
      if (DESIGN_MINTING_TOOLS.has(raw.type) && raw.output?.design_id) {
        createdId = raw.output.design_id
        createdToken = typeof raw.output.design_token === "string" ? raw.output.design_token : null
      }
      if (BOARD_TOOLS.has(raw.type)) {
        const key = String(raw.toolCallId ?? `${m.id}:${raw.type}`)
        if (!handled.has(key)) {
          handled.add(key)
          shouldRefresh = true
        }
      }
    }
  }
  return { createdId, createdToken, shouldRefresh }
}
