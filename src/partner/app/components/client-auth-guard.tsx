"use client"

import { useEffect } from "react"
import { usePathname, useRouter } from "next/navigation"

function hasAuthCookie() {
  if (typeof document === "undefined") return false
  return document.cookie.split(";").some((c) => c.trim().startsWith("medusa_jwt="))
}

export default function ClientAuthGuard() {
  const pathname = usePathname()
  const router = useRouter()

  useEffect(() => {
    const tokenPresent = hasAuthCookie()

    // If logged in and on public auth pages, go to dashboard
    if (tokenPresent && (pathname === "/login" || pathname === "/register")) {
      router.replace("/dashboard")
      return
    }

    // If not logged in and trying to access dashboard root, let server guard handle redirects
    // We keep this minimal to avoid client/server race loops.
  }, [pathname, router])

  return null
}
