"use client"

import { usePathname } from "next/navigation"
import React from "react"

/**
 * Design-studio shell — switches the storefront chrome off on the immersive
 * design routes so the chat-based design editor can run full-screen.
 *
 * The routes themselves stay put (no route-group juggling); this client
 * component just reads the pathname and drops the nav / footer / launcher
 * when the current page is the design studio.
 */
const DESIGN_STUDIO_PATTERNS = [
  /^\/[^/]+\/design\/?$/,
  /^\/[^/]+\/products\/[^/]+\/design\/?$/,
]

const isDesignStudioRoute = (pathname: string) =>
  DESIGN_STUDIO_PATTERNS.some((re) => re.test(pathname))

export default function DesignStudioShell({
  chrome,
  footer,
  launcher,
  children,
}: {
  chrome: React.ReactNode
  footer: React.ReactNode
  launcher: React.ReactNode
  children: React.ReactNode
}) {
  const pathname = usePathname()
  const isStudio = isDesignStudioRoute(pathname ?? "")

  if (isStudio) {
    return <>{children}</>
  }

  return (
    <>
      {chrome}
      {children}
      {footer}
      {launcher}
    </>
  )
}