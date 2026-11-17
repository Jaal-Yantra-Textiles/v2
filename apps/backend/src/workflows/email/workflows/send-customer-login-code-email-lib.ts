/** What the email log keeps in place of the code. */
export const REDACTED_LOGIN_CODE = "••••••"

/**
 * Replaces every copy of the code in a notification's `data` — the raw
 * `code`, and the rendered subject and HTML that embed it.
 */
export const redactLoginCode = (
  data: Record<string, any> | null | undefined,
  code: string
): Record<string, any> => {
  const out: Record<string, any> = {}
  for (const [key, value] of Object.entries(data ?? {})) {
    if (key === "code") out[key] = REDACTED_LOGIN_CODE
    else if (typeof value === "string") out[key] = value.split(code).join(REDACTED_LOGIN_CODE)
    else out[key] = value
  }
  return out
}
