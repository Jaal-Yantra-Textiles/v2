import { NextResponse } from "next/server"

export const runtime = "nodejs"

// Deprecated: client now uses server actions to call backend directly.
export async function POST() {
  return NextResponse.json(
    {
      error: "This proxy route is deprecated. Use server action partnerUploadAndAttachDesignMediaAction.",
    },
    { status: 410 }
  )
}