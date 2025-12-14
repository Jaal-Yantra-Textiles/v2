import {
  BuildingStorefront,
  CogSixTooth,
  EllipsisHorizontal,
  MagnifyingGlass,
  OpenRectArrowOut,
  PencilSquare,
  TimelineVertical,
} from "@medusajs/icons"
import { Avatar, Divider, DropdownMenu, Kbd, Text, clx } from "@medusajs/ui"
import { useTranslation } from "react-i18next"

import { usePartnerStores } from "../../../hooks/api/partner-stores"
import { useMe } from "../../../hooks/api/users"
import { Skeleton } from "../../common/skeleton"
import { INavItem, NavItem } from "../../layout/nav-item"
import { Shell } from "../../layout/shell"

import { Link, useNavigate } from "react-router-dom"
import { useLogout } from "../../../hooks/api"
import { queryClient } from "../../../lib/query-client"
import { UserMenu } from "../user-menu"
import { useDocumentDirection } from "../../../hooks/use-document-direction"
import { useSearch } from "../../../providers/search-provider"

export const MainLayout = () => {
  return (
    <Shell>
      <MainSidebar />
    </Shell>
  )
}

const MainSidebar = () => {
  return (
    <aside className="flex flex-1 flex-col justify-between overflow-y-auto">
      <div className="flex flex-1 flex-col">
        <div className="bg-ui-bg-subtle sticky top-0">
          <Header />
          <div className="px-3">
            <Divider variant="dashed" />
          </div>
        </div>
        <div className="flex flex-1 flex-col justify-between">
          <div className="flex flex-1 flex-col">
            <CoreRouteSection />
          </div>
          <UtilitySection />
        </div>
        <div className="bg-ui-bg-subtle sticky bottom-0">
          <UserSection />
        </div>
      </div>
    </aside>
  )
}

const Logout = () => {
  const { t } = useTranslation()
  const navigate = useNavigate()

  const { mutateAsync: logoutMutation } = useLogout()

  const handleLogout = async () => {
    await logoutMutation(undefined, {
      onSuccess: () => {
        /**
         * When the user logs out, we want to clear the query cache
         */
        queryClient.clear()
        navigate("/login")
      },
    })
  }

  return (
    <DropdownMenu.Item onClick={handleLogout}>
      <div className="flex items-center gap-x-2">
        <OpenRectArrowOut className="text-ui-fg-subtle" />
        <span>{t("app.menus.actions.logout")}</span>
      </div>
    </DropdownMenu.Item>
  )
}

const Header = () => {
  const { t } = useTranslation()
  const { stores, isPending, isError, error } = usePartnerStores()
  const { user } = useMe()
  const direction = useDocumentDirection()
  const activeStore = stores?.[0]
  const partnerName = user?.partner?.name || user?.first_name
  const partnerHandle = user?.partner?.handle
  const name = activeStore?.name || partnerName || "Partner Space"
  const secondary = partnerHandle ? `@${partnerHandle}` : t("app.nav.main.store")
  const fallback = name?.slice(0, 1).toUpperCase()

  const isLoaded = !isPending && !!name && !!fallback

  if (isError) {
    throw error
  }

  return (
    <div className="w-full p-3">
    <DropdownMenu
          dir={direction}>
        <DropdownMenu.Trigger
          disabled={!isLoaded}
          className={clx(
            "bg-ui-bg-subtle transition-fg grid w-full grid-cols-[24px_1fr_15px] items-center gap-x-3 rounded-md p-0.5 pe-2 outline-none",
            "hover:bg-ui-bg-subtle-hover",
            "data-[state=open]:bg-ui-bg-subtle-hover",
            "focus-visible:shadow-borders-focus"
          )}
        >
          {fallback ? (
            <Avatar variant="squared" size="xsmall" fallback={fallback} />
          ) : (
            <Skeleton className="h-6 w-6 rounded-md" />
          )}
          <div className="block overflow-hidden text-start">
            {name ? (
              <Text
                size="small"
                weight="plus"
                leading="compact"
                className="truncate"
              >
                {name}
              </Text>
            ) : (
              <Skeleton className="h-[9px] w-[120px]" />
            )}
          </div>
          <EllipsisHorizontal className="text-ui-fg-muted" />
        </DropdownMenu.Trigger>
        {isLoaded && (
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
                  {secondary}
                </Text>
              </div>
            </div>
            <DropdownMenu.Separator />
            <DropdownMenu.Item className="gap-x-2" asChild>
              <Link to="/settings/store">
                <BuildingStorefront className="text-ui-fg-subtle" />
                {t("app.nav.main.store")}
              </Link>
            </DropdownMenu.Item>
            <DropdownMenu.Separator />
            <Logout />
          </DropdownMenu.Content>
        )}
      </DropdownMenu>
    </div>
  )
}

const useCoreRoutes = (): Omit<INavItem, "pathname">[] => {
  return [
    {
      icon: <MagnifyingGlass />,
      label: "Home",
      to: "/",
    },
    {
      icon: <PencilSquare />,
      label: "Designs",
      to: "/designs",
    },
    {
      icon: <BuildingStorefront />,
      label: "Inventory Orders",
      to: "/inventory-orders",
    },
    {
      icon: <TimelineVertical />,
      label: "Tasks",
      to: "/tasks",
    },
  ]
}

const Searchbar = () => {
  const { toggleSearch } = useSearch()

  return (
    <button
      type="button"
      onClick={toggleSearch}
      className={clx(
        "bg-ui-bg-subtle transition-fg hover:bg-ui-bg-subtle-hover text-ui-fg-muted mx-3 flex items-center justify-between gap-x-2 rounded-md px-2 py-1.5 outline-none",
        "focus-visible:shadow-borders-focus"
      )}
    >
      <div className="flex items-center gap-x-2">
        <MagnifyingGlass />
        <Text size="small" leading="compact" className="text-ui-fg-subtle">
          Search
        </Text>
      </div>
      <div className="flex items-center gap-x-1">
        <Kbd>⌘</Kbd>
        <Kbd>K</Kbd>
      </div>
    </button>
  )
}

const CoreRouteSection = () => {
  const coreRoutes = useCoreRoutes()

  return (
    <nav className="flex flex-col gap-y-1 py-3">
      <Searchbar />
      {coreRoutes.map((route) => {
        return <NavItem key={route.to} {...route} />
      })}
    </nav>
  )
}

const UtilitySection = () => {
  return (
    <div className="pb-3">
      <nav className="flex flex-col gap-y-1 py-3">
        <NavItem
          icon={<CogSixTooth />}
          label="Settings"
          to="/settings"
          type="core"
        />
      </nav>
    </div>
  )
}

const UserSection = () => {
  return (
    <div>
      <div className="px-3">
        <Divider variant="dashed" />
      </div>
      <UserMenu />
    </div>
  )
}
