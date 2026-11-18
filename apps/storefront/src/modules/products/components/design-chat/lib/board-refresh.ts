/**
 * Which board-mutating tool results are NEW since the last pass (#2543).
 *
 * The design studio runs this on every `messages` change, and messages change
 * on every streamed chunk. Without the `handled` set, any earlier completed
 * tool re-fired a board refresh per chunk: ~3 GET /designs/:id a second for
 * the rest of the session (seen live on prod, 2026-11-16).
 *
 * #2556: a chat can hold several designs. Tools that make a design ACTIVE
 * (create, generate, start another, switch, pin a link) hand back its id and
 * token; `list_my_designs` hands back every design. All of them become tabs.
 */
import type { DesignTab } from "./design-tabs"

/** Tools whose output names the design that is now active. */
const ACTIVATING_TOOLS = new Set([
  "tool-create_design",
  "tool-generate_design_image",
  "tool-start_new_design",
  "tool-switch_design",
  "tool-add_reference_link",
])
const BOARD_TOOLS = new Set([
  "tool-generate_design_image",
  "tool-save_moodboard",
  "tool-create_design",
  "tool-start_new_design",
  "tool-switch_design",
  "tool-add_reference_link",
])

type MessageLike = { id?: string; role?: string; parts?: unknown[] }

export type BoardToolEvents = {
  /** Latest design id a tool made active. */
  createdId: string | null
  /** Its design access token, when the tool returned one. */
  createdToken: string | null
  /** True only if a board tool completed since the last call. */
  shouldRefresh: boolean
  /** Every design a tool reported (for the tabs). */
  designs: DesignTab[]
}

const tabFrom = (o: any): DesignTab | null =>
  o && typeof o.design_id === "string"
    ? {
        design_id: o.design_id,
        ...(typeof o.design_token === "string" ? { design_token: o.design_token } : {}),
        ...(o.name ? { name: String(o.name) } : {}),
        ...(o.product_type ? { product_type: String(o.product_type) } : {}),
        ...(o.thumbnail_url ? { thumbnail_url: String(o.thumbnail_url) } : {}),
      }
    : null

const callKey = (m: MessageLike, raw: any) => String(raw.toolCallId ?? `${m.id}:${raw.type}`)

/**
 * Mutates `handled`: each completed tool call refreshes the board once.
 *
 * `activated`, when given, makes activation one-shot too: a tool call moves
 * the active design only the first time it is seen. Without it, the latest
 * activating call in the transcript would win on every pass — and undo the
 * maker clicking another design's tab.
 */
export function collectBoardToolEvents(
  messages: MessageLike[],
  handled: Set<string>,
  activated?: Set<string>
): BoardToolEvents {
  let createdId: string | null = null
  let createdToken: string | null = null
  let shouldRefresh = false
  const designs: DesignTab[] = []

  for (const m of messages) {
    if (m.role !== "assistant") continue
    for (const raw of (m.parts ?? []) as any[]) {
      if (raw?.state !== "output-available") continue
      const key = callKey(m, raw)
      if (ACTIVATING_TOOLS.has(raw.type) && raw.output?.design_id && raw.output?.ok !== false) {
        const tab = tabFrom(raw.output)
        if (tab) designs.push(tab)
        if (!activated || !activated.has(key)) {
          activated?.add(key)
          createdId = raw.output.design_id
          createdToken = typeof raw.output.design_token === "string" ? raw.output.design_token : null
        }
      }
      if (raw.type === "tool-list_my_designs" && Array.isArray(raw.output?.designs)) {
        for (const d of raw.output.designs) {
          const tab = tabFrom(d)
          if (tab) designs.push(tab)
        }
      }
      if (BOARD_TOOLS.has(raw.type)) {
        if (!handled.has(key)) {
          handled.add(key)
          shouldRefresh = true
        }
      }
    }
  }
  return { createdId, createdToken, shouldRefresh, designs }
}

/**
 * Mark every finished tool call in a restored thread as already seen, so a
 * reload keeps the design the maker last had open instead of jumping to the
 * last one a tool activated.
 */
export function primeActivated(messages: MessageLike[], activated: Set<string>): void {
  for (const m of messages) {
    if (m.role !== "assistant") continue
    for (const raw of (m.parts ?? []) as any[]) {
      if (raw?.state === "output-available" && ACTIVATING_TOOLS.has(raw.type)) {
        activated.add(callKey(m, raw))
      }
    }
  }
}
