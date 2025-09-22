"use client"

import { useEffect } from "react"
import { usePathname, useRouter } from "next/navigation"

/**
 * AuthLayer combines:
 * - Client-side route guard (redirects away from /login when authenticated)
 * - Session validation by pinging /api/auth/status; on 401 it redirects to /login
 */
export default function AuthLayer() {
  const router = useRouter()
  const pathname = usePathname()

  // Simple session validator on mount and route change
  useEffect(() => {
    let aborted = false

    const check = async () => {
      try {
        const res = await fetch("/api/auth/status", { cache: "no-store" })
        if (aborted) return

        const onAuthPage = pathname === "/login" || pathname === "/register"
        if (res.status === 200) {
          // Session valid; do not force redirect from auth pages to avoid loops
          return
        }

        // Treat non-200 as unauthorized
        try {
          // Clear client cookie shadow (best effort)
          document.cookie = "medusa_jwt=; Max-Age=0; path=/; SameSite=Lax"
        } catch {}
        // Ensure HttpOnly cookie cleared on server
        try {
          await fetch("/api/auth/logout", { method: "POST" })
        } catch {}
        if (!onAuthPage) {
          router.replace("/login")
        }
      } catch {
        // Network error: be conservative and route to login if not already there
        const onAuthPage = pathname === "/login" || pathname === "/register"
        try {
          document.cookie = "medusa_jwt=; Max-Age=0; path=/; SameSite=Lax"
        } catch {}
        try {
          await fetch("/api/auth/logout", { method: "POST" })
        } catch {}
        if (!onAuthPage) {
          router.replace("/login")
        }
      }
    }

    check()
    return () => {
      aborted = true
    }
  }, [pathname, router])

  return null
}

