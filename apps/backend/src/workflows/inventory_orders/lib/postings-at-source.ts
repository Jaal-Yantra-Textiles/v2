/**
 * #2286 follow-up — did an inventory order's goods get posted at its SOURCE?
 *
 * Until #2287, receive, the supplier's portal Complete and cancel resolved the
 * destination as `stock_locations[0]`, which on a two-ended order can be the
 * supplier's own warehouse. This classifies each received line of such an
 * order so an operator can see where the stock went. It decides nothing and
 * repairs nothing.
 *
 * Evidence, strongest first:
 * - `confirmed`: a receipt audit row (`goods_received`) posted this line's item
 *   AT the source location.
 * - `likely`: something was received, the item holds stock at the source, and
 *   the destination holds less than was received. The supplier's Complete path
 *   records no location, so this is inference. Stock at the source can also be
 *   the supplier's own genuine inventory; a human decides.
 * - `ok`: the destination holds at least what was received.
 */

export type PostingLineInput = {
  line_id: string
  item_id: string | null
  name: string | null
  price: number
  received: number
  stocked_at_source: number
  stocked_at_destination: number
  /** Quantity a receipt audit row posted for this item AT the source. */
  receipt_posted_at_source: number
}

export type PostingVerdict = "confirmed" | "likely" | "ok" | "not_received"

export type ClassifiedLine = PostingLineInput & {
  verdict: PostingVerdict
  /** Units that appear to sit at the source instead of the destination. */
  misplaced: number
  value: number
}

const round = (n: number) => Math.round(n * 1000) / 1000

export function classifyPostingLine(l: PostingLineInput): ClassifiedLine {
  const received = Number(l.received) || 0
  if (received <= 0 || !l.item_id) {
    return { ...l, verdict: "not_received", misplaced: 0, value: 0 }
  }
  if (l.receipt_posted_at_source > 0) {
    const misplaced = round(Math.min(received, l.receipt_posted_at_source))
    return { ...l, verdict: "confirmed", misplaced, value: round(misplaced * (Number(l.price) || 0)) }
  }
  const shortAtDestination = round(received - (Number(l.stocked_at_destination) || 0))
  if (shortAtDestination > 0 && (Number(l.stocked_at_source) || 0) > 0) {
    const misplaced = round(Math.min(shortAtDestination, Number(l.stocked_at_source)))
    return { ...l, verdict: "likely", misplaced, value: round(misplaced * (Number(l.price) || 0)) }
  }
  return { ...l, verdict: "ok", misplaced: 0, value: 0 }
}
