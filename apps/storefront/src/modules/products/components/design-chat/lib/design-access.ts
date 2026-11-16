/**
 * Design access on the client (#2543).
 *
 * The backend hands back a design token whenever a design is created for (or
 * attached to) this browser — from `create_design` / `generate_design_image`
 * tool output and from the references upload — and a conversation token when
 * a thread is mirrored. Every design-scoped call presents them; without them
 * the backend answers 403 ("belongs to another session").
 *
 * Both tokens live in the local thread (`jyt:design-thread:*`) next to the ids
 * they unlock, and "Start a new design" clears them with the thread.
 */

export const DESIGN_TOKEN_HEADER = "x-design-token"
export const CONVERSATION_TOKEN_HEADER = "x-conversation-token"

export const designTokenHeaders = (
  token?: string | null
): Record<string, string> => (token ? { [DESIGN_TOKEN_HEADER]: token } : {})

export const conversationTokenHeaders = (
  token?: string | null
): Record<string, string> =>
  token ? { [CONVERSATION_TOKEN_HEADER]: token } : {}

export const DESIGN_FORBIDDEN_MESSAGE =
  "This design belongs to another session. Start a new design to keep going."

const minutesFrom = (text: string): number | null => {
  const m = text.match(/(\d+)\s*min/i)
  return m ? Number(m[1]) : null
}

/**
 * A maker-readable line for a failed design call. 403 and 429 get the fixed
 * copy; anything else keeps the server's message when it has one.
 */
export const describeDesignError = (
  status: number | undefined,
  message: string | undefined,
  fallback: string
): string => {
  if (status === 403) return DESIGN_FORBIDDEN_MESSAGE
  if (status === 429) {
    const mins = minutesFrom(message ?? "")
    return mins
      ? `Too many requests — try again in ${mins} min.`
      : "Too many requests — try again in a few minutes."
  }
  return message?.trim() || fallback
}

/** An Error carrying the HTTP status, so callers can branch on 403. */
export class DesignRequestError extends Error {
  readonly status?: number
  constructor(message: string, status?: number) {
    super(message)
    this.name = "DesignRequestError"
    this.status = status
  }
}

/** Normalise anything thrown by `sdk.client.fetch` (FetchError has `status`). */
export const toDesignRequestError = (
  error: unknown,
  fallback: string
): DesignRequestError => {
  const e = error as { status?: number; message?: string } | null
  const status = typeof e?.status === "number" ? e.status : undefined
  return new DesignRequestError(
    describeDesignError(status, e?.message, fallback),
    status
  )
}

/**
 * The chat stream's error (useChat) — DefaultChatTransport puts the raw
 * response body in `message`, so the JSON the backend sent is in there.
 */
export const describeChatError = (error: Error | undefined): string | null => {
  if (!error) return null
  const raw = error.message ?? ""
  try {
    const parsed = JSON.parse(raw) as { code?: string; message?: string }
    if (parsed?.code === "design_access_denied") return DESIGN_FORBIDDEN_MESSAGE
    if (parsed?.code === "rate_limited") {
      return describeDesignError(429, parsed.message, "")
    }
  } catch {
    // Not JSON — fall through.
  }
  if (/design_access_denied/.test(raw)) return DESIGN_FORBIDDEN_MESSAGE
  if (/rate_limited|too many requests/i.test(raw)) {
    return describeDesignError(429, raw, "")
  }
  return null
}

/** True when the chat failed because this browser lost access to the design. */
export const isDesignForbiddenChatError = (error: Error | undefined): boolean =>
  Boolean(error && /design_access_denied/.test(error.message ?? ""))
