import type { NextRequest } from "next/server"
import { NextResponse } from "next/server"

export default function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl
  const token = request.cookies.get("medusa_jwt")?.value

  // Public pages that don't require authentication
  const publicPages = new Set(["/login", "/register", "/favicon.ico"]) // Extend as needed

  // If user is not authenticated and path is not public, redirect to login
  if (!token && !publicPages.has(pathname)) {
    const url = new URL("/login", request.url)
    // Preserve intended destination to possibly redirect after login
    url.searchParams.set("next", pathname)
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
