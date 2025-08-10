"use client"

import {
  Avatar,
  Divider,
  DropdownMenu,
  Text,
  clx,
} from "@medusajs/ui"
import {
  ArrowUturnLeft,
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
import { usePathname } from "next/navigation"
import Link from "next/link"

import { NavItem, NavItemProps } from "./nav-item"
import { logout } from "../../dashboard/actions"
import { useSettingsRoutes, useIsSettingsRoute } from "./use-settings-routes"

const useCoreRoutes = (): Omit<NavItemProps, "pathname">[] => {
  return [
    {
      icon: <ShoppingCart />,
      label: "Orders",
      to: "/dashboard/orders",
    },
    {
      icon: <ReceiptPercent />,
      label: "Inventory Orders",
      to: "/dashboard/inventory-orders",
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
  const isSettingsRoute = useIsSettingsRoute()
  const settingsRoutes = useSettingsRoutes()

  if (isSettingsRoute) {
    return (
      <nav className="flex flex-col gap-y-1 px-3 py-3">
        {settingsRoutes.map((route) => {
          return <NavItem key={route.to} {...route} />
        })}
      </nav>
    )
  }

  return (
    <nav className="flex flex-col gap-y-1 px-3 py-3">
      {coreRoutes.map((route) => {
        return <NavItem key={route.to} {...route} />
      })}
    </nav>
  )
}

const Header = ({ partner }: { partner: PartnerDetails | null }) => {
  const companyName = partner?.name || "JYT Partner Space"
  const companyHandle = partner?.handle
  const fallback = partner?.name?.[0] || "J"

  return (
    <div className="flex h-14 items-center justify-between px-3">
      <div className="flex items-center gap-x-2">
        <Avatar
          variant="squared"
          fallback={fallback}
          className="bg-ui-bg-base text-ui-fg-subtle"
        />
        <div>
          <Text
            size="small"
            leading="compact"
            weight="plus"
            className="text-ui-fg-base"
          >
            {companyName.slice(0, 20)}
          </Text>
          {companyHandle && (
            <Text size="xsmall" className="text-ui-fg-subtle">
              {`@${companyHandle}`}
            </Text>
          )}
        </div>
      </div>
      <div className="text-ui-fg-muted">
        <DropdownMenu>
          <DropdownMenu.Trigger asChild>
            <button>
              <EllipsisHorizontal />
            </button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Content>
            <DropdownMenu.Item>Store details</DropdownMenu.Item>
            <DropdownMenu.Item>Go to store</DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu>
      </div>
    </div>
  )
}

interface Admin {
  first_name: string | null
  last_name: string | null
  email: string
}

interface PartnerDetails {
  name: string
  handle: string | null
  admins: Admin[]
}

const UserSection = ({ userDetails }: { userDetails: PartnerDetails | null }) => {

  const admin = userDetails?.admins?.[0]

  const name = [admin?.first_name, admin?.last_name].filter(Boolean).join(" ")

  const user = {
    name: name || "Admin User",
    email: admin?.email || "admin@jyt.com",
    avatar:
      (name || "A")
        .split(" ")
        .map((n: string) => n[0])
        .join(""),
  }

  return (
    <div className="w-full p-3">
      <DropdownMenu>
        <DropdownMenu.Trigger
          className={clx(
            "transition-fg grid w-full grid-cols-[24px_1fr_15px] items-center gap-x-3 rounded-md p-0.5 pr-2 outline-none",
            "hover:bg-ui-bg-base-hover",
            "data-[state=open]:bg-ui-bg-base-hover",
            "focus-visible:shadow-borders-focus"
          )}
        >
          <Avatar variant="squared" size="xsmall" fallback={user.avatar} />
          <div className="block overflow-hidden text-left">
            <Text
              size="small"
              weight="plus"
              leading="compact"
              className="truncate"
            >
              {user.name}
            </Text>
          </div>
          <EllipsisHorizontal className="text-ui-fg-muted" />
        </DropdownMenu.Trigger>
        <DropdownMenu.Content className="w-[var(--radix-dropdown-menu-trigger-width)] min-w-0">
          <div className="flex items-center gap-x-3 px-2 py-1">
            <Avatar variant="squared" size="small" fallback={user.avatar} />
            <div className="flex flex-col overflow-hidden">
              <Text
                size="small"
                weight="plus"
                leading="compact"
                className="truncate"
              >
                {user.name}
              </Text>
              <Text
                size="xsmall"
                leading="compact"
                className="text-ui-fg-subtle truncate"
              >
                {user.email}
              </Text>
            </div>
          </div>
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

export default function Sidebar({ partner }: { partner: PartnerDetails | null }) {
  const pathname = usePathname()
  const isSettingsRoute = pathname?.startsWith("/dashboard/settings")

  return (
    <aside className="bg-ui-bg-subtle flex h-full w-full flex-col justify-between">
      <div>
        {isSettingsRoute ? (
          <div className="flex h-14 items-center px-3">
            <Link href="/dashboard" className="flex items-center gap-x-2 text-ui-fg-subtle hover:text-ui-fg-base">
              <ArrowUturnLeft className="text-ui-fg-subtle" />
            </Link>
          </div>
        ) : (
          <Header partner={partner} />
        )}
        <Divider variant="dashed"/>
        <CoreRouteSection />
      </div>
      <div className="flex flex-col">
        {!isSettingsRoute && (
          <div className="flex flex-col gap-y-1 px-3 py-3">
            <NavItem
              icon={<CogSixTooth />}
              to="/dashboard/settings"
              label="Settings"
            />
          </div>
        )}
        <Divider variant="dashed" />
        <UserSection userDetails={partner} />
      </div>
    </aside>
  )
}
