"use client"

import { BellAlert, CogSixTooth } from "@medusajs/icons"
import { IconButton } from "@medusajs/ui"
import { usePathname } from "next/navigation"

export const TopNavbar = () => {
  const pathname = usePathname()
  const isSettingsRoute = pathname?.startsWith("/dashboard/settings")
  
  // Determine the settings page title based on the current path
  const getSettingsTitle = () => {
    if (pathname === "/dashboard/settings/profile") return "Profile Settings"
    if (pathname === "/dashboard/settings/people") return "People Settings"
    if (pathname === "/dashboard/settings/payments") return "Payments Settings"
    return "Settings"
  }
  
  const settingsTitle = getSettingsTitle()
  
  return (
    <header className="bg-ui-bg-subtle flex h-14 items-center justify-between border-b px-8">
      {isSettingsRoute && (
        <div className="flex items-center gap-x-2 text-ui-fg-subtle">
          <CogSixTooth className="text-ui-fg-subtle" />
          <span>{settingsTitle}</span>
        </div>
      )}
      <div className="flex items-center gap-x-4">
        <IconButton>
          <BellAlert />
        </IconButton>
      </div>
    </header>
  )
}
