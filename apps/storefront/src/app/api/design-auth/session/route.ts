/**
 * DELETE /api/design-auth/session — "Not you?" in the design studio
 * (#2543 phase 2). Drops the session cookie; the buyer can verify another
 * email. Bearer sessions have no server state, so nothing else to revoke.
 */
import { cookies } from "next/headers"
import { revalidateTag } from "next/cache"

import { SESSION_COOKIE } from "@lib/util/design-auth-backend"
import { getCacheTag } from "@lib/data/cookies"

export const dynamic = "force-dynamic"

export async function DELETE() {
  const jar = await cookies()
  jar.set(SESSION_COOKIE, "", { maxAge: -1, path: "/" })
  const tag = await getCacheTag("customers")
  if (tag) revalidateTag(tag)
  return Response.json({ signed_out: true })
}
