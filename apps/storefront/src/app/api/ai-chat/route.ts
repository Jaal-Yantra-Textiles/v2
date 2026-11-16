/**
 * POST /api/ai-chat
 *
 * Same-origin proxy in front of the Medusa backend's `POST /store/ai/chat`
 * streaming endpoint.
 *
 * Why a proxy at all:
 *   - Keeps MEDUSA_BACKEND_URL a server-side secret (no
 *     NEXT_PUBLIC_* leak into the client bundle).
 *   - Same-origin call → no browser CORS pre-flight on every chat turn.
 *   - Adds the publishable API key Medusa requires for /store/*
 *     endpoints; the storefront client doesn't have it on hand.
 *
 * Why not a server action like `searchAiProducts`:
 *   - Server actions buffer the response. We need to PIPE the
 *     SSE/UI-message stream straight through so the client sees tokens
 *     as they arrive. A Next.js Route Handler can return the upstream
 *     `Response` directly, which preserves streaming.
 *
 * Runtime: defaults to Node.js (Fluid Compute). We don't pin "edge"
 * because the backend stream uses Node primitives via Medusa and the
 * proxy never inspects the body — we just hand the upstream Response
 * back. Node runtime supports streaming Responses just fine.
 */

import { cookies } from "next/headers"

const BACKEND_URL =
  process.env.MEDUSA_BACKEND_URL ??
  process.env.NEXT_PUBLIC_MEDUSA_BACKEND_URL ??
  "http://localhost:9000"

const PUBLISHABLE_KEY =
  process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY ??
  process.env.MEDUSA_PUBLISHABLE_KEY

// Disable Next.js static optimization — streaming responses must be
// dynamic, and this route should not be pre-rendered or cached.
export const dynamic = "force-dynamic"

export async function POST(req: Request) {
  // Forward the raw body. We deliberately re-stream rather than parse
  // + re-stringify: the backend validates the shape, and parsing here
  // would just add latency and a second source of truth for the
  // schema.
  const body = await req.text()

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  }
  if (PUBLISHABLE_KEY) {
    headers["x-publishable-api-key"] = PUBLISHABLE_KEY
  }

  /**
   * #2543: the backend rate-limits the chat per visitor AND per IP, and
   * every request from here would otherwise arrive from this server's own
   * address — one shared bucket for every shopper. Forward the shopper's IP
   * (Vercel sets x-forwarded-for / x-real-ip on the inbound request).
   */
  const shopperIp =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip")?.trim() ||
    ""
  if (shopperIp) headers["x-forwarded-for"] = shopperIp

  /**
   * A signed-in shopper's session, so the backend can let them into designs
   * linked to their account (the guest path is the design token in the body
   * context). The session cookie is httpOnly — only this server can read it.
   */
  try {
    const jwt = (await cookies()).get("_medusa_jwt")?.value
    if (jwt) headers["authorization"] = `Bearer ${jwt}`
  } catch {
    // No request scope (should not happen in a route handler) — guest.
  }

  let upstream: Response
  try {
    upstream = await fetch(`${BACKEND_URL}/store/ai/chat`, {
      method: "POST",
      headers,
      body,
      // Important — without `duplex: "half"` Node fetch refuses to
      // stream a body upstream when the response is also a stream. We
      // don't stream the request body (it's fully buffered above), but
      // setting it is safe and future-proofs the route if we ever do.
      // @ts-expect-error — undici-specific option, missing from the
      // lib.dom Request type but accepted at runtime.
      duplex: "half",
    })
  } catch (e: any) {
    return new Response(
      JSON.stringify({
        error: "Failed to reach chat backend",
        detail: e?.message ?? String(e),
      }),
      {
        status: 502,
        headers: { "Content-Type": "application/json" },
      }
    )
  }

  // Re-emit the upstream response verbatim. The upstream sets the
  // proper SSE Content-Type and framing; we just pass body + headers +
  // status through.
  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: upstream.headers,
  })
}
