"use client"

import { useEffect } from "react"

/**
 * Tiny client-side helper that marks the homepage as "seen" via a cookie
 * the next request can read.
 *
 * Rationale: gating the hero on the server (see app/[countryCode]/(main)/
 * page.tsx) keeps Hero from running its `listPublicMedia` fetch for
 * returning visitors and avoids the hydration flash you get when a
 * client component flips between two server-rendered trees. The trade-
 * off is the cookie has to be set somewhere — we set it client-side on
 * every render so first-time visitors get the hero now, and the next
 * SSR (be it a refresh or a navigation) sees the cookie and skips it.
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
