"use client"

import { useEffect } from "react"
import { usePathname, useRouter } from "next/navigation"

/**
 * Global auth interceptor that patches window.fetch to handle 401/403 responses.
 * On unauthorized, it clears the auth cookie and redirects to /login.
 */
export default function AuthInterceptor() {
  const router = useRouter()
  const pathname = usePathname()

  useEffect(() => {
    if (typeof window === "undefined" || typeof fetch === "undefined") {
      return
    }

    const originalFetch = window.fetch

    const clearAuthAndRedirect = () => {
      try {
        // Clear the medusa_jwt cookie
        document.cookie = "medusa_jwt=; Max-Age=0; path=/; SameSite=Lax"
      } catch (_) {
        // no-op
      }

      // Avoid infinite loop if we are already on the login page
      if (pathname !== "/login") {
        router.replace("/login")
      }
    }

    // Patch fetch to catch 401/403 globally
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      try {
        const res = await originalFetch(input , init)
        if (res.status === 401 || res.status === 403) {
          // Ignore auth endpoints to prevent redirect loop while logging in/registering
          const url = typeof input === "string" ? input : (input as URL).toString()
          const isAuthCall = /\/auth\//.test(url) || /\/login$/.test(url) || /\/register$/.test(url)
          if (!isAuthCall) {
            clearAuthAndRedirect()
          }
        }
        return res
      } catch (err) {
        // Network error - let the app handle it normally
        throw err
      }
    }

    return () => {
      // Restore original fetch on unmount
      window.fetch = originalFetch
    }
  }, [router, pathname])

  return null
}
