import "server-only"

/**
 * Backend plumbing for the design studio's email sign-in route handlers
 * (app/api/design-auth/*, #2543 phase 2). Server-only: the session cookie is
 * httpOnly and the backend URL stays off the client.
 */

export const BACKEND_URL =
  process.env.MEDUSA_BACKEND_URL ??
  process.env.NEXT_PUBLIC_MEDUSA_BACKEND_URL ??
  "http://localhost:9000"

export const PUBLISHABLE_KEY =
  process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY ?? process.env.MEDUSA_PUBLISHABLE_KEY

/**
 * The shopper's IP, forwarded so the backend's per-IP code-send cap counts
 * shoppers, not this server (every call would otherwise share one bucket).
 */
export const shopperIpHeaders = (req: Request): Record<string, string> => {
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip")?.trim() ||
    ""
  return ip ? { "x-forwarded-for": ip } : {}
}

export const backendJson = async (
  path: string,
  init: { body?: unknown; headers?: Record<string, string> } = {}
): Promise<{ status: number; data: any; headers: Headers }> => {
  const res = await fetch(`${BACKEND_URL}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(PUBLISHABLE_KEY ? { "x-publishable-api-key": PUBLISHABLE_KEY } : {}),
      ...(init.headers ?? {}),
    },
    body: JSON.stringify(init.body ?? {}),
    cache: "no-store",
  })
  const data = await res.json().catch(() => ({}))
  return { status: res.status, data, headers: res.headers }
}

/** `{ code, message, retry_after_seconds }` for a backend 429. */
export const rateLimited = (headers: Headers, data: any) => {
  const retry = Number(headers.get("retry-after") ?? data?.retry_after_seconds ?? 0) || null
  return Response.json(
    { code: "rate_limited", retry_after_seconds: retry },
    { status: 429, headers: retry ? { "retry-after": String(retry) } : {} }
  )
}

export const SESSION_COOKIE = "_medusa_jwt"
export const SESSION_COOKIE_OPTIONS = {
  maxAge: 60 * 60 * 24 * 7,
  httpOnly: true,
  sameSite: "strict" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
}
