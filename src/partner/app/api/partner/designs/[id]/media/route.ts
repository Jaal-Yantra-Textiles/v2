import { NextRequest, NextResponse } from "next/server"
import { cookies } from "next/headers"

export const runtime = "nodejs"

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    if (!id) {
      return NextResponse.json({ error: "Missing design id in route params" }, { status: 400 })
    }
    const cookieStore = await cookies()
    const token = cookieStore.get("medusa_jwt")?.value || null
    if (!token) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
    }

    const formData = await req.formData()

    const BASE_URL = process.env.MEDUSA_BACKEND_URL || process.env.NEXT_PUBLIC_MEDUSA_BACKEND_URL || "http://localhost:9000"
    const upstream = await fetch(`${BASE_URL}/partners/designs/${id}/media`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
      },
      body: formData,
      // no-store to avoid caching in dev
      cache: "no-store",
    })

    const text = await upstream.text()
    if (!upstream.ok) {
      // Try to return structured JSON if upstream sent JSON
      const contentType = upstream.headers.get("content-type") || ""
      if (contentType.includes("application/json")) {
        return NextResponse.json(JSON.parse(text || "{}"), { status: upstream.status })
      }
      return new NextResponse(text || "Upstream error", { status: upstream.status })
    }
    return new NextResponse(text, { status: upstream.status, headers: { "content-type": upstream.headers.get("content-type") || "application/json" } })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Proxy error"
    return NextResponse.json({ error: msg, proxy: "partner/designs/[id]/media" }, { status: 500 })
  }
}
