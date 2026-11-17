/**
 * POST /api/design-auth/code  { email }
 *
 * Asks the backend's `email-otp` auth provider to email a 6-digit sign-in
 * code (#2543 phase 2). The provider answers a send with a non-success
 * (`401 code_sent`) by design — Medusa's auth route has no "pending" state —
 * so this translates it to `200 { sent: true }`. Known and unknown emails get
 * the same answer.
 */
import {
  backendJson,
  rateLimited,
  shopperIpHeaders,
} from "@lib/util/design-auth-backend"

export const dynamic = "force-dynamic"

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}))
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : ""
  if (!email) return Response.json({ code: "invalid_email" }, { status: 400 })

  let upstream
  try {
    upstream = await backendJson("/auth/customer/email-otp", {
      body: { email },
      headers: shopperIpHeaders(req),
    })
  } catch {
    return Response.json({ code: "send_failed" }, { status: 502 })
  }

  if (upstream.status === 429) return rateLimited(upstream.headers, upstream.data)
  const message = upstream.data?.message
  if (message === "code_sent") return Response.json({ sent: true })
  return Response.json(
    { code: message === "invalid_email" ? "invalid_email" : "send_failed" },
    { status: message === "invalid_email" ? 400 : 502 }
  )
}
