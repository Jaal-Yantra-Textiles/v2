/**
 * POST /api/design-auth/verify  { email, code }
 *
 * Second step of the design studio's email sign-in (#2543 phase 2):
 *
 *   1. `POST /auth/customer/email-otp { email, code }` — the provider checks
 *      the code (expiry, 5-try cap, single use) and Medusa issues a token;
 *   2. `POST /store/custom/auth/email-otp/complete` — attaches or creates the
 *      customer account for the VERIFIED email and adopts the buyer's guest
 *      studio designs;
 *   3. `POST /auth/token/refresh` — a token that carries the customer;
 *   4. stores it in the same httpOnly `_medusa_jwt` cookie the account login
 *      uses, so every customer-authenticated store call (estimate, checkout,
 *      /api/ai-chat) sees the buyer as signed in.
 */
import { cookies } from "next/headers"
import { revalidateTag } from "next/cache"

import {
  backendJson,
  rateLimited,
  SESSION_COOKIE,
  SESSION_COOKIE_OPTIONS,
  shopperIpHeaders,
} from "@lib/util/design-auth-backend"
import { getCacheTag } from "@lib/data/cookies"

export const dynamic = "force-dynamic"

const CODE_ERRORS = new Set(["invalid_code", "code_expired", "too_many_attempts", "invalid_email"])

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}))
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : ""
  const code = typeof body?.code === "string" ? body.code.replace(/\D/g, "") : ""
  if (!email || code.length !== 6) {
    return Response.json({ code: email ? "invalid_code" : "invalid_email" }, { status: 400 })
  }

  try {
    const verified = await backendJson("/auth/customer/email-otp", {
      body: { email, code },
      headers: shopperIpHeaders(req),
    })
    if (verified.status === 429) return rateLimited(verified.headers, verified.data)
    const first = verified.data?.token as string | undefined
    if (verified.status !== 200 || !first) {
      const reason = verified.data?.message
      return Response.json(
        { code: CODE_ERRORS.has(reason) ? reason : "invalid_code" },
        { status: 400 }
      )
    }

    const bearer = (t: string) => ({ authorization: `Bearer ${t}` })
    const completed = await backendJson("/store/custom/auth/email-otp/complete", {
      headers: bearer(first),
    })
    if (completed.status !== 200) {
      return Response.json({ code: "unknown" }, { status: 502 })
    }

    const refreshed = await backendJson("/auth/token/refresh", { headers: bearer(first) })
    const token = refreshed.data?.token as string | undefined
    if (refreshed.status !== 200 || !token) {
      return Response.json({ code: "unknown" }, { status: 502 })
    }

    const jar = await cookies()
    jar.set(SESSION_COOKIE, token, SESSION_COOKIE_OPTIONS)
    const tag = await getCacheTag("customers")
    if (tag) revalidateTag(tag)

    return Response.json({
      email: completed.data.email,
      customer_id: completed.data.customer_id,
      adopted_design_ids: completed.data.adopted_design_ids ?? [],
    })
  } catch {
    return Response.json({ code: "unknown" }, { status: 502 })
  }
}
