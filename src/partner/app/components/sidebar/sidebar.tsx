"use client"

import {
  Avatar,
  Divider,
  DropdownMenu,
  Text,
  clx,
} from "@medusajs/ui"
import {
  BuildingStorefront,
  Buildings,
  CogSixTooth,
  CurrencyDollar,
  EllipsisHorizontal,
  OpenRectArrowOut,
  ReceiptPercent,
  ShoppingCart,
  Tag,
  Users,
} from "@medusajs/icons"
import Link from "next/link"

import { NavItem, NavItemProps } from "./nav-item"
import { logout } from "../../dashboard/actions"

const useCoreRoutes = (): Omit<NavItemProps, "pathname">[] => {
  return [
    {
      icon: <ShoppingCart />,
      label: "Orders",
      to: "/dashboard/orders",
    },
    {
      icon: <Tag />,
      label: "Products",
      to: "/dashboard/products",
      items: [
        {
          label: "Collections",
          to: "/dashboard/collections",
        },
        {
          label: "Categories",
          to: "/dashboard/categories",
        },
      ],
    },
    {
      icon: <Buildings />,
      label: "Inventory",
      to: "/dashboard/inventory",
    },
    {
      icon: <Users />,
      label: "Customers",
      to: "/dashboard/customers",
    },
    {
      icon: <ReceiptPercent />,
      label: "Promotions",
      to: "/dashboard/promotions",
    },
    {
      icon: <CurrencyDollar />,
      label: "Price Lists",
      to: "/dashboard/price-lists",
    },
  ]
}

const CoreRouteSection = () => {
  const coreRoutes = useCoreRoutes()

  return (
    <nav className="flex flex-col gap-y-1 px-3 py-3">
      {coreRoutes.map((route) => {
        return <NavItem key={route.to} {...route} />
      })}
    </nav>
  )
}

const Header = () => {
  const name = "JYT Partner Space"
  const fallback = "J"

  return (
    <div className="w-full p-3">
      <DropdownMenu>
        <DropdownMenu.Trigger
          className={clx(
            "bg-ui-bg-subtle transition-fg grid w-full grid-cols-[24px_1fr_15px] items-center gap-x-3 rounded-md p-0.5 pr-2 outline-none",
            "hover:bg-ui-bg-subtle-hover",
            "data-[state=open]:bg-ui-bg-subtle-hover",
            "focus-visible:shadow-borders-focus"
          )}
        >
          <Avatar variant="squared" size="xsmall" fallback={fallback} />
          <div className="block overflow-hidden text-left">
            <Text
              size="small"
              weight="plus"
              leading="compact"
              className="truncate"
            >
              {name}
            </Text>
          </div>
          <EllipsisHorizontal className="text-ui-fg-muted" />
        </DropdownMenu.Trigger>
        <DropdownMenu.Content className="w-[var(--radix-dropdown-menu-trigger-width)] min-w-0">
          <div className="flex items-center gap-x-3 px-2 py-1">
            <Avatar variant="squared" size="small" fallback={fallback} />
            <div className="flex flex-col overflow-hidden">
              <Text
                size="small"
                weight="plus"
                leading="compact"
                className="truncate"
              >
                {name}
              </Text>
              <Text
                size="xsmall"
                leading="compact"
                className="text-ui-fg-subtle"
              >
                Store
              </Text>
            </div>
          </div>
          <DropdownMenu.Separator />
          <DropdownMenu.Item className="gap-x-2" asChild>
            <Link href="/dashboard/settings/store">
              <BuildingStorefront className="text-ui-fg-subtle" />
              Store Settings
            </Link>
          </DropdownMenu.Item>
          <DropdownMenu.Separator />
          <form action={logout}>
            <button type="submit" className="w-full">
              <DropdownMenu.Item>
                <div className="flex items-center gap-x-2">
                  <OpenRectArrowOut className="text-ui-fg-subtle" />
                  <span>Logout</span>
                </div>
              </DropdownMenu.Item>
            </button>
          </form>
        </DropdownMenu.Content>
      </DropdownMenu>
    </div>
  )
}

const UserSection = () => {
  return (
    <div className="w-full p-3">
      <div className="w-full">
        <Divider className="-ml-3 -mr-3 w-[calc(100%+1.5rem)]" />
        <div className="flex flex-col gap-y-1 py-3">
          <NavItem
            icon={<CogSixTooth />}
            to="/dashboard/settings"
            label="Settings"
          />
        </div>
        <div className="flex items-center gap-x-3 p-3">
          <Avatar variant="squared" size="xsmall" fallback="A" />
          <div className="flex flex-col overflow-hidden">
            <Text
              size="small"
              weight="plus"
              leading="compact"
              className="truncate"
            >
              Admin
            </Text>
            <Text
              size="xsmall"
              leading="compact"
              className="text-ui-fg-subtle truncate"
            >
              admin@jyt.com
            </Text>
          </div>
        </div>
      </div>
    </div>
  )
}

export const Sidebar = () => {
  return (
    <aside className="bg-ui-bg-subtle flex h-full w-full flex-col justify-between">
      <div>
        <Header />
        <CoreRouteSection />
      </div>
      <UserSection />
    </aside>
  )
}
