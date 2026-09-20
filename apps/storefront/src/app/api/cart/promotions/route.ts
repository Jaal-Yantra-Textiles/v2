import { NextResponse } from "next/server"
import { serializeMedusaError } from "@lib/util/medusa-error"
import { describePromotionFailure } from "@lib/util/promotion-error"
import { applyPromotions } from "@lib/data/cart"

export async function POST(req: Request) {
  try {
    const { codes } = (await req.json()) as { codes?: string[] }

    if (!Array.isArray(codes)) {
      return NextResponse.json(
        { ok: false, error: "Invalid request body: expected 'codes' array" },
        { status: 400 }
      )
    }

    await applyPromotions(codes)

    return NextResponse.json({ ok: true })
  } catch (err: any) {
    const s = serializeMedusaError(err)
    /**
     * A one-per-customer promotion on an anonymous cart fails with the
     * promotion module's own internal string. Translate it here — where every
     * caller of this route goes through — rather than in one component, and
     * tell the client to offer the one action that helps (#2194).
     */
    const failure = describePromotionFailure(s)

    return NextResponse.json(
      {
        ok: false,
        error: failure.message,
        requires_sign_in: failure.requiresSignIn,
        code: s.code,
        status: s.status,
      },
      { status: s.status || 400 }
    )
  }
}
