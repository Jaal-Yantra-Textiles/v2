/**
 * Design studio email sign-in — pure helpers (#2543 phase 2).
 *
 * The buyer verifies their email with a 6-digit code before a design is saved
 * or an image is generated. The network half lives in the same-origin route
 * handlers under app/api/design-auth/*; this file is the logic the panel and
 * the chat share, kept pure so vitest can pin it.
 */

export const OTP_CODE_LENGTH = 6
/** Seconds before "Resend code" unlocks after a send. */
export const RESEND_COOLDOWN_SECONDS = 30

/** Digits only, at most 6 — what a pasted "123 456" or "Code: 123456" becomes. */
export const normalizeCodeInput = (raw: string): string =>
  String(raw ?? "").replace(/\D/g, "").slice(0, OTP_CODE_LENGTH)

export const isCompleteCode = (code: string): boolean =>
  new RegExp(`^\\d{${OTP_CODE_LENGTH}}$`).test(code)

export const normalizeEmailInput = (raw: string): string =>
  String(raw ?? "").trim().toLowerCase()

export const isValidEmail = (raw: string): boolean =>
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeEmailInput(raw)) &&
  normalizeEmailInput(raw).length <= 254

/** Whole seconds left on the resend cooldown (0 = can resend). */
export const resendSecondsLeft = (
  sentAtMs: number | null,
  nowMs: number,
  cooldown = RESEND_COOLDOWN_SECONDS
): number => {
  if (!sentAtMs) return 0
  return Math.max(0, Math.ceil((sentAtMs + cooldown * 1000 - nowMs) / 1000))
}

export type OtpErrorCode =
  | "invalid_email"
  | "invalid_code"
  | "code_expired"
  | "too_many_attempts"
  | "rate_limited"
  | "send_failed"
  | "unknown"

/** Buyer-facing copy for an error code from /api/design-auth/*. */
export const describeOtpError = (
  code: string | null | undefined,
  retryAfterSeconds?: number | null
): string => {
  switch (code) {
    case "invalid_email":
      return "That doesn't look like an email address."
    case "invalid_code":
      return "That code isn't right. Check the email and try again."
    case "code_expired":
      return "That code has expired. Send a new one."
    case "too_many_attempts":
      return "Too many wrong tries for that code. Send a new one."
    case "rate_limited": {
      const mins = retryAfterSeconds ? Math.max(1, Math.ceil(retryAfterSeconds / 60)) : null
      return mins
        ? `Too many codes requested. Try again in ${mins} min.`
        : "Too many codes requested. Try again in a few minutes."
    }
    case "send_failed":
      return "We couldn't send the code just now. Try again in a moment."
    default:
      return "Something went wrong. Try again."
  }
}

/** Errors after which the old code is dead and the buyer must resend. */
export const needsNewCode = (code: string | null | undefined): boolean =>
  code === "code_expired" || code === "too_many_attempts"

const SIGN_IN_TOOLS = new Set(["tool-create_design", "tool-generate_design_image"])

/**
 * Did the LATEST assistant turn hit a tool that needs a verified email?
 * The backend's create_design / generate_design_image answer
 * `{ sign_in_required: true }` for a guest; the UI then opens the panel.
 */
export const findSignInRequired = (
  messages: Array<{ role?: string; parts?: Array<any> }> | null | undefined
): boolean => {
  const list = messages ?? []
  for (let i = list.length - 1; i >= 0; i--) {
    const m = list[i]
    if (m?.role !== "assistant") continue
    return (m.parts ?? []).some(
      (p: any) =>
        SIGN_IN_TOOLS.has(p?.type) &&
        p?.state === "output-available" &&
        p?.output?.sign_in_required === true
    )
  }
  return false
}
