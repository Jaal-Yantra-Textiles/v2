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

  const shortenId = (id: string) => (id && id.length > 12 ? `${id.slice(0, 10)}…${id.slice(-4)}` : id)

  // Determine a general page title for non-settings routes
  const getRouteTitle = () => {
    if (!pathname) return "Dashboard"

    // Detail page patterns: insert the entity id into the title
    const segs = pathname.split("/").filter(Boolean)
    // Expecting ["dashboard", "designs", ":id", ...]
    if (segs[0] === "dashboard" && segs[1] === "designs" && segs[2]) {
      return `Designs: ${shortenId(decodeURIComponent(segs[2]))}`
    }
    // Expecting ["dashboard", "inventory-orders", ":id", ...]
    if (segs[0] === "dashboard" && segs[1] === "inventory-orders" && segs[2]) {
      return `Inventory Orders: ${shortenId(decodeURIComponent(segs[2]))}`
    }

    // Exact/section matches
    if (pathname === "/dashboard") return "Dashboard"
    if (pathname.startsWith("/dashboard/inventory-orders")) return "Inventory Orders"
    if (pathname.startsWith("/dashboard/orders")) return "Orders"
    if (pathname.startsWith("/dashboard/products")) return "Products"
    if (pathname.startsWith("/dashboard/collections")) return "Collections"
    if (pathname.startsWith("/dashboard/categories")) return "Categories"
    if (pathname.startsWith("/dashboard/customers")) return "Customers"
    if (pathname.startsWith("/dashboard/promotions")) return "Promotions"
    if (pathname.startsWith("/dashboard/price-lists")) return "Price Lists"

    // Fallback: take last path segment and title-case it
    const seg = segs.pop() || "Dashboard"
    return seg
      .split("-")
      .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
      .join(" ")
  }
  
  const settingsTitle = getSettingsTitle()
  const routeTitle = getRouteTitle()
  
  return (
    <header className="bg-ui-bg-subtle flex h-14 items-center justify-between border-b pl-16 pr-14 md:px-8">
      <div className="flex items-center gap-x-3 text-ui-fg-subtle flex-1 min-w-0 justify-center md:justify-start">
        {isSettingsRoute ? (
          <>
            <CogSixTooth className="text-ui-fg-subtle hidden md:inline" />
            <span className="truncate text-center md:text-left font-medium text-ui-fg-base">
              {settingsTitle}
            </span>
          </>
        ) : (
          <span className="truncate text-center md:text-left font-medium text-ui-fg-base">
            {routeTitle}
          </span>
        )}
      </div>
      {/* Desktop bell (md+) */}
      <div className="hidden md:flex items-center gap-x-4 shrink-0">
        <IconButton aria-label="Notifications">
          <BellAlert />
        </IconButton>
      </div>
      {/* Mobile bell: fixed top-right, mirrors menu spacing */}
      <div className="fixed top-2 right-1 z-50 md:hidden">
        <IconButton aria-label="Notifications">
          <BellAlert className="text-ui-fg-subtle" />
        </IconButton>
      </div>
    </header>
  )
}
