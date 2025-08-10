"use client"

import { useEffect, useState } from "react"
import { IconButton } from "@medusajs/ui"
import { SidebarRight } from "@medusajs/icons"
import Sidebar from "./sidebar/sidebar"
import { usePathname } from "next/navigation"

type Admin = {
  first_name: string | null
  last_name: string | null
  email: string
}

type PartnerDetails = {
  name: string
  handle: string | null
  admins: Admin[]
}

export default function MobileSidebarOverlay({ partner }: { partner: PartnerDetails | null }) {
  const [open, setOpen] = useState(false)
  const pathname = usePathname()

  // Auto-close overlay when route changes
  useEffect(() => {
    setOpen(false)
  }, [pathname])

  return (
    <>
      {/* Toggle button visible on small screens, above everything */}
      <div className="fixed top-2 left-1 z-50 md:hidden">
        <IconButton aria-label="Open menu" onClick={() => setOpen(true)}>
          <SidebarRight className="text-ui-fg-subtle" />
        </IconButton>
      </div>

      {open && (
        <div className="fixed inset-0 z-50 md:hidden">
          {/* Backdrop */}
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />

          {/* Drawer panel */}
          <div
            className="absolute left-0 top-0 h-full w-56 bg-ui-bg-base border-r border-ui-border-base shadow-xl"
            onClick={(e) => {
              // If a link (<a>) inside sidebar is clicked, close the drawer
              const target = e.target as HTMLElement
              const anchor = target.closest('a')
              if (anchor) {
                setOpen(false)
              }
            }}
          >
            <Sidebar partner={partner} />
          </div>
        </div>
      )}
    </>
  )
}
