"use client"

import { Bell } from "@medusajs/icons"
import { IconButton } from "@medusajs/ui"

export const TopNavbar = () => {
  return (
    <header className="bg-ui-bg-subtle flex h-14 items-center justify-end gap-x-4 border-b px-8">
      <IconButton>
        <Bell />
      </IconButton>
    </header>
  )
}
