/**
 * Request body for /api/ai-chat from the design studio (#2543).
 *
 * useChat (@ai-sdk/react) builds its Chat ONCE and ignores a new transport on
 * later renders, so the transport must call a getter for live values. Closing
 * over render-time state froze design_id/design_token at null: the design id
 * never reached the backend, and a guest's own design was refused next turn.
 */

export type DesignChatLive = {
  /** Already in wire format (toWireFormat(prefs)). */
  prefs: unknown
  productId?: string | null
  designId?: string | null
  designToken?: string | null
  email?: string | null
  /** The chat's OTHER designs (#2556), each with its token. */
  designs?: Array<{ design_id: string; design_token?: string }>
  /** "+ Another design" was pressed: the backend starts the new design itself. */
  newPiece?: boolean
}

export function buildDesignChatBody(live: DesignChatLive, visitorId: string | null) {
  return {
    visitor_id: visitorId ?? "anonymous",
    prefs: live.prefs,
    context: {
      ...(live.productId ? { product_id: live.productId } : {}),
      ...(live.designId ? { design_id: live.designId } : {}),
      // A token without its design id means nothing; never send it alone.
      ...(live.designId && live.designToken ? { design_token: live.designToken } : {}),
      ...(live.email ? { email: live.email } : {}),
      ...(live.designs?.length ? { designs: live.designs.slice(0, 12) } : {}),
      ...(live.newPiece ? { new_piece: true } : {}),
    },
  }
}

/** The transport's `body` option: re-reads live values on every request. */
export const makeDesignChatBody =
  (getLive: () => DesignChatLive, getVisitorId: () => string | null) => () =>
    buildDesignChatBody(getLive(), getVisitorId())
