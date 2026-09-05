export type ChatErrorAdvice = {
  title: string
  detail?: string
  retryable: boolean
}

/**
 * Turn whatever `useChat` surfaced into something an operator can act on.
 *
 * A single "the assistant hit an error" line is useless when the real cause is
 * an expired admin session or one failing tool — the operator retries forever
 * against a problem retrying cannot fix. Transport/auth faults are separated
 * from model faults so the message can say what to actually do.
 *
 * 🔴 The fallback branch printed the browser's own words as the explanation,
 * and in Safari those words are **"Load failed"** — which is what an operator
 * was actually shown. It names no cause and suggests no action, and it is what
 * a `fetch` says for everything from a dropped wifi connection to a gateway
 * timeout 60 seconds into a slow tool call. Every phrase below is a real
 * browser/runtime string, matched so the message can be honest instead.
 */

/** WebKit says "Load failed"; Chrome "Failed to fetch"; Firefox its own thing. */
const NETWORK_HINTS = [
  "load failed",
  "failed to fetch",
  "networkerror",
  "network error",
  "network connection was lost",
  "econnrefused",
  "econnreset",
  "enotfound",
  "socket hang up",
  "terminated",
  "err_network",
  "err_internet_disconnected",
]

/**
 * A request that ran past somebody's clock — ours, the gateway's, or the
 * model's. Distinguished from a dead connection because the advice differs:
 * the server is probably fine and busy, and retrying is reasonable.
 */
const TIMEOUT_HINTS = [
  "504",
  "502",
  "408",
  "gateway time-out",
  "gateway timeout",
  "timeout",
  "timed out",
  "etimedout",
  "aborted",
  "aborterror",
  "the operation was aborted",
]

const hasAny = (haystack: string, needles: string[]): boolean =>
  needles.some((n) => haystack.includes(n))

export function describeChatError(error: unknown): ChatErrorAdvice {
  const raw = (error as any)?.message ? String((error as any).message) : ""
  const lower = raw.toLowerCase()

  if (/\b401\b|unauthor/i.test(raw)) {
    return {
      title: "Your admin session expired.",
      detail: "Reload the page to sign in again — retrying won't help until you do.",
      retryable: false,
    }
  }
  if (/\b503\b|not configured/i.test(raw)) {
    return {
      title: "The admin assistant isn't configured.",
      detail:
        "Add a platform with role ai_admin_assistant under Settings → External Platforms, or set OPENROUTER_API_KEY.",
      retryable: false,
    }
  }
  if (/\b429\b|rate limit/i.test(raw)) {
    return {
      title: "The model is rate-limited.",
      detail: "Wait a moment before retrying.",
      retryable: true,
    }
  }

  /**
   * 🔑 Checked BEFORE the network branch. A 504 arrives at the browser as a
   * failed fetch too, and "check your connection" is the wrong advice for a
   * connection that worked perfectly — it was the answer that never came.
   */
  if (hasAny(lower, TIMEOUT_HINTS)) {
    return {
      title: "The assistant is busy — that took too long to answer.",
      detail:
        "The request ran past the gateway's limit before a reply came back. Try again; a tool that reads an image or searches a lot of records can take a while, and it may still be working.",
      retryable: true,
    }
  }

  if (hasAny(lower, NETWORK_HINTS)) {
    return {
      title: "Couldn't reach the server.",
      detail: "Check your connection, then try again.",
      retryable: true,
    }
  }

  return {
    title: "The assistant hit an error.",
    /**
     * The raw text is kept, but it is never the whole message: it is a clue
     * under a sentence that already says what happened.
     */
    detail: raw ? `Try again. If it keeps happening: ${raw}` : "Try again.",
    retryable: true,
  }
}
