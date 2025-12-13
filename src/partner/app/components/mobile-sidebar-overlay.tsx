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
  store_name?: string | null
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

      {/* Overlay root */}
      <div className={`fixed inset-0 z-50 md:hidden ${open ? '' : 'pointer-events-none'}`}>
        {/* Backdrop with fade */}
        <div
          className={`absolute inset-0 bg-black/40 transition-opacity duration-300 ${open ? 'opacity-100' : 'opacity-0'}`}
          onClick={() => setOpen(false)}
        />

        {/* Drawer panel with slide animation and near full width */}
        <div
          className={`absolute left-0 top-0 h-full w-[92vw] max-w-[24rem] bg-ui-bg-base border-r border-ui-border-base shadow-xl
          transition-transform duration-300 ease-out ${open ? 'translate-x-0' : '-translate-x-full'}`}
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
    </>
  )
}
