"use client"

import { useEffect } from "react"

/**
 * Tiny client-side helper that marks the homepage as "seen" via a cookie
 * the next request can read.
 *
 * On first load the homepage omits hero and holiday sections entirely.
 * This cookie gates the holiday section — once set, returning visitors
 * see the holiday section on subsequent requests.
 *
 * The cookie is set client-side on every render. On first load the server
 * won't see the cookie yet (it's set after hydration), so nothing above
 * products renders. On the next SSR (refresh or navigation) the cookie
 * is present and the holiday section appears.
 *
 * 1-year max-age, SameSite=Lax — same scope you'd use for any UI-pref
 * cookie. Path=/ so it applies across country code segments. No
 * sensitive data, doesn't need HttpOnly.
 *
 * Returns null — pure side-effect component.
 */
const COOKIE = "jyt_hero_seen"

export default function HeroSeenMarker() {
  useEffect(() => {
    try {
      if (document.cookie.includes(`${COOKIE}=`)) return
      document.cookie = `${COOKIE}=1; Path=/; Max-Age=31536000; SameSite=Lax`
    } catch {
      // cookies disabled — we'll show the hero again next visit, which
      // is acceptable degraded behaviour.
    }
  }, [])
  return null
}

export const HERO_SEEN_COOKIE = COOKIE
