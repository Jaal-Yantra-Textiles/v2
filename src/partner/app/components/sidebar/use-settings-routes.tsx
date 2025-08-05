import { usePathname } from "next/navigation"

export const useSettingsRoutes = () => {
  return [
    {
      label: "Profile",
      to: "/dashboard/settings/profile",
    },
    {
      label: "People",
      to: "/dashboard/settings/people",
    },
    {
      label: "Payments",
      to: "/dashboard/settings/payments",
    },
  ]
}

export const useIsSettingsRoute = () => {
  const pathname = usePathname()
  return pathname?.startsWith("/dashboard/settings")
}
