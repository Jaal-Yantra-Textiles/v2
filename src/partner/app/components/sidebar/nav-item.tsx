"use client"

import { clx } from "@medusajs/ui"
import * as Collapsible from "@radix-ui/react-collapsible"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { ReactNode } from "react"

export type NavItemProps = {
  label: string
  to: string
  icon?: ReactNode
  items?: NavItemProps[]
}

export const NavItem = ({ label, to, icon, items }: NavItemProps) => {
  const pathname = usePathname()
  const isActive = pathname.startsWith(to)

  if (items && items.length > 0) {
    return (
      <Collapsible.Root defaultOpen={isActive} className="w-full">
        <Collapsible.Trigger
          className={clx(
            "bg-ui-bg-subtle text-ui-fg-subtle group flex w-full items-center gap-x-2 rounded-md px-2 py-1.5 text-sm outline-none transition-colors focus:bg-ui-bg-base-hover",
            {
              "bg-ui-bg-base-hover": isActive,
            }
          )}
        >
          {icon}
          <span>{label}</span>
        </Collapsible.Trigger>
        <Collapsible.Content>
          <div className="flex flex-col gap-y-1 py-1 pl-5">
            {items.map((item) => (
              <NavItem key={item.label} {...item} />
            ))}
          </div>
        </Collapsible.Content>
      </Collapsible.Root>
    )
  }

  return (
    <Link
      href={to}
      className={clx(
        "text-ui-fg-subtle group flex items-center gap-x-2 rounded-md px-2 py-1.5 text-sm",
        "hover:bg-ui-bg-base-hover focus-visible:bg-ui-bg-base-hover outline-none",
        {
          "bg-ui-bg-base-hover text-ui-fg-base": isActive,
        }
      )}
    >
      {icon}
      <span>{label}</span>
    </Link>
  )
}
