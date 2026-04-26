import { NextResponse } from "next/server"
import { serializeMedusaError } from "@lib/util/medusa-error"
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
    return NextResponse.json(
      { ok: false, error: s.message, code: s.code, status: s.status },
      { status: s.status || 400 }
    )
  }
}
