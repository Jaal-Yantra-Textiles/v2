import type { NextRequest } from "next/server"
import { NextResponse } from "next/server"

export default function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl
  const token = request.cookies.get("medusa_jwt")?.value

  // Pages that should not be accessible when already authenticated
  const authPages = new Set(["/login", "/register"]) // add "/reset-password" if needed

  if (token && authPages.has(pathname)) {
    const url = new URL("/dashboard", request.url)
    return NextResponse.redirect(url)
  }

  return NextResponse.next()
}

// Don't run middleware for these files
export const config = {
  matcher: [
    // Match all request paths except for the ones starting with:
    // - api (API routes)
    // - _next/static (static files)
    // - _next/image (image optimization files)
    // - favicon.ico (favicon file)
    "/((?!api|_next/static|_next/image|favicon.ico).*)",
  ],
}
