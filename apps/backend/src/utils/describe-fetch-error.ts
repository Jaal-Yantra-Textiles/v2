// Turn an opaque outbound-fetch failure into a single actionable string.
//
// Background (#704): when `fetch()` (undici, Node ≥18) fails at the network
// level — connect timeout, connection reset, DNS lookup failure — it throws a
// generic `TypeError: fetch failed` and the REAL reason lives on `error.cause`
// (e.g. `{ code: "ETIMEDOUT", syscall: "connect", address: "157.240.1.1",
// port: 443 }`). Recording only `err.message` ("fetch failed") makes prod
// incidents undiagnosable. This helper unwraps that cause and the target host
// so failure logs say WHY, mirroring the quality of a non-OK HTTP branch that
// already records status + body.
//
// Pure: no I/O, no throws. Safe to call on any thrown value (Error, undici
// TypeError, or a non-Error primitive).

type FetchCause = {
  code?: string
  errno?: number
  syscall?: string
  address?: string
  port?: number
  hostname?: string
  message?: string
}

function hostFromUrl(url?: string): string | undefined {
  if (!url) return undefined
  try {
    return new URL(url).host
  } catch {
    return undefined
  }
}

// Pull the undici-style cause off an Error, if present and object-shaped.
function extractCause(err: unknown): FetchCause | undefined {
  if (!err || typeof err !== "object") return undefined
  const cause = (err as { cause?: unknown }).cause
  if (!cause || typeof cause !== "object") return undefined
  return cause as FetchCause
}

// Build the low-level network detail, e.g. "connect ETIMEDOUT 157.240.1.1:443"
// or "getaddrinfo ENOTFOUND graph.facebook.com". Returns undefined when the
// cause carries nothing useful.
function describeCause(cause: FetchCause): string | undefined {
  const parts: string[] = []
  if (cause.syscall) parts.push(cause.syscall)
  if (cause.code) parts.push(cause.code)

  const target =
    cause.address && cause.port != null
      ? `${cause.address}:${cause.port}`
      : cause.address || cause.hostname
  if (target) parts.push(target)

  if (parts.length) return parts.join(" ")
  // Fall back to the cause's own message if it had no structured fields.
  if (cause.message) return cause.message
  return undefined
}

export function describeFetchError(
  err: unknown,
  opts?: { url?: string; label?: string }
): string {
  const label = opts?.label
  const host = hostFromUrl(opts?.url)

  // Prefix: "<label> to <host>" / "<label>" / "<host>" — whichever we have.
  let prefix = ""
  if (label && host) prefix = `${label} to ${host}`
  else if (label) prefix = label
  else if (host) prefix = host

  const cause = extractCause(err)
  const causeDetail = cause ? describeCause(cause) : undefined

  // Base message: prefer the unwrapped network cause; otherwise the error's
  // own message; otherwise the stringified non-Error value.
  let baseMessage: string
  if (err instanceof Error) {
    baseMessage = err.message || "Error"
  } else if (err && typeof err === "object" && "message" in err) {
    baseMessage = String((err as { message?: unknown }).message ?? err)
  } else {
    baseMessage = String(err)
  }

  // When undici gives the generic "fetch failed" but we recovered a real
  // cause, surface the cause instead of the useless top-line.
  const isGenericFetchFailure = /fetch failed/i.test(baseMessage)
  const detail =
    causeDetail && (isGenericFetchFailure || causeDetail !== baseMessage)
      ? causeDetail
      : baseMessage

  if (prefix) return `${prefix} failed: ${detail}`
  return detail
}
