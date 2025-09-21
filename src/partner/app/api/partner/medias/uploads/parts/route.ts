import { NextRequest, NextResponse } from "next/server"
import { cookies } from "next/headers"

export const runtime = "nodejs"

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    console.info("[partner-proxy:parts] request", {
      uploadId: body?.uploadId,
      key: (body?.key || "").toString().slice(0, 80),
      partNumbers: Array.isArray(body?.partNumbers) ? body.partNumbers : [],
    })
    const cookieStore = await cookies()
    const token = cookieStore.get("medusa_jwt")?.value
    if (!token) return NextResponse.json({ message: "Not authenticated" }, { status: 401 })

    const BASE_URL = process.env.MEDUSA_BACKEND_URL || process.env.NEXT_PUBLIC_MEDUSA_BACKEND_URL || "http://localhost:9000"
    const upstream = await fetch(`${BASE_URL}/partners/medias/uploads/parts`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
      cache: "no-store",
    })
    console.info("[partner-proxy:parts] upstream status", upstream.status)
    const text = await upstream.text()
    return new NextResponse(text, {
      status: upstream.status,
      headers: { "content-type": upstream.headers.get("content-type") || "application/json" },
    })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Proxy error"
    console.error("[partner-proxy:parts] error", msg)
    return NextResponse.json({ message: msg }, { status: 500 })
  }
}
