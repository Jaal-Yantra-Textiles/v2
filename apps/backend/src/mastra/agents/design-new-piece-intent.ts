/**
 * Did the maker just ask for ANOTHER piece? (#2556)
 *
 * The prompt already tells the model to call `start_new_design` when the maker
 * asks for a second piece. On prod (2026-11-19) it did not: three times in a
 * row it wrote "Design created ✅ Design ID 01M7RRB2…" without calling any
 * tool, and that id never existed. The model only sees its OWN earlier text
 * (tool calls are stripped from history), and that text is full of "Design
 * created ✅" lines, so it copies them.
 *
 * So the clear cases do not go through the model at all: the route starts the
 * design itself, before the model runs, when this returns an intent.
 *
 * Kept deliberately narrow: a false positive creates a design the maker did
 * not ask for. It fires only when the LAST message names a garment that none
 * of their open designs is already for, together with a word that asks for
 * more ("now", "also", "matching", "another"…). A garment named without such
 * a word ("wear it with trousers?") is left to the model.
 */
import { garmentsIn } from "./storefront-design-chat"

export type NewPieceIntent = {
  /** The garment of the new piece, when the maker named one. */
  product_type: string | null
  source: "button" | "message"
}

const MORE_CUE =
  /\b(now|also|another|matching|match|next|add|too|plus|as well|second|new|then|design (?:a|the|some|my))\b/i

const samePiece = (a: string, b: string) => a === b || a.includes(b) || b.includes(a)

export const detectNewPieceIntent = (input: {
  /** The maker's latest message, as typed. */
  lastUserText: string
  /** The active design's garment. Without one, a garment named now IS its brief. */
  activeGarment: string | null | undefined
  /** Garments of the conversation's other open designs. */
  openGarments?: Array<string | null | undefined>
  /** The "+ Another design" button was pressed. */
  explicit?: boolean
}): NewPieceIntent | null => {
  const named = garmentsIn(input.lastUserText)
  const taken = [input.activeGarment, ...(input.openGarments ?? [])]
    .filter((g): g is string => typeof g === "string" && g.length > 0)
    .flatMap((g) => garmentsIn(g).concat(g.toLowerCase()))
  const fresh = named.filter((g) => !taken.some((t) => samePiece(g, t)))

  if (input.explicit) {
    return { product_type: fresh[0] ?? null, source: "button" }
  }
  if (!input.activeGarment) return null
  if (!fresh.length) return null
  if (!MORE_CUE.test(input.lastUserText)) return null
  return { product_type: fresh[0], source: "message" }
}
