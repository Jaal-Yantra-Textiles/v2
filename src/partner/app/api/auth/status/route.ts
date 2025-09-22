import { NextResponse } from "next/server"
import { getAuthCookie, clearAuthCookie } from "../../../../lib/auth-cookie"

export async function GET() {
  const token = await getAuthCookie()
  if (!token) {
    await clearAuthCookie()
    return NextResponse.json({ ok: false }, { status: 401 })
  }

  const MEDUSA_BACKEND_URL =
    process.env.MEDUSA_BACKEND_URL ||
    process.env.NEXT_PUBLIC_MEDUSA_BACKEND_URL ||
    "http://localhost:9000"

  try {
    const res = await fetch(`${MEDUSA_BACKEND_URL}/partners/details`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      cache: "no-store",
    })

    if (res.status === 401 || res.status === 403) {
      await clearAuthCookie()
      return NextResponse.json({ ok: false }, { status: 401 })
    }

    return NextResponse.json({ ok: true }, { status: 200 })
  } catch {
    await clearAuthCookie()
    return NextResponse.json({ ok: false }, { status: 401 })
  }
}

