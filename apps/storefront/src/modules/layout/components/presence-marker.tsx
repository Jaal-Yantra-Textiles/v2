"use client"

import { useEffect } from "react"

/**
 * Ensures the `jyt_visitor_id` exists in localStorage before any
 * user interaction. The analytics script (analytics.min.js) also
 * writes this key, but it may be blocked by ad-blockers or load
 * late — this guarantees the id is available for cart stamping
 * and chat from the very first render.
 *
 * Also syncs any UTM params present in the current URL to
 * sessionStorage so the `window.jytAnalytics` global (if loaded)
 * picks them up even if the analytics script's own capture runs
 * after this component.
 *
 * Pure side-effect — renders null.
 */
export default function PresenceMarker() {
  useEffect(() => {
    try {
      const STORAGE_KEY = "jyt_visitor_id"
      if (!localStorage.getItem(STORAGE_KEY)) {
        const id = crypto.randomUUID()
        localStorage.setItem(STORAGE_KEY, id)
      }
    } catch {
      // localStorage unavailable (private mode, quota) — non-fatal
    }

    // Best-effort: if analytics.js hasn't captured UTMs from the URL
    // yet (script blocked or still loading), stash them in
    // sessionStorage["jyt_utm"] so the conversion/journey calls can
    // still read them.
    try {
      const utmKeys = [
        "utm_source",
        "utm_medium",
        "utm_campaign",
        "utm_term",
        "utm_content",
      ]
      const params = new URLSearchParams(window.location.search)
      const captured: Record<string, string> = {}
      for (const key of utmKeys) {
        const val = params.get(key)
        if (val) captured[key] = val
      }

      if (Object.keys(captured).length > 0) {
        const existing = sessionStorage.getItem("jyt_utm")
        if (!existing) {
          sessionStorage.setItem("jyt_utm", JSON.stringify(captured))
        }
      }
    } catch {
      // sessionStorage unavailable — non-fatal
    }
  }, [])

  return null
}
