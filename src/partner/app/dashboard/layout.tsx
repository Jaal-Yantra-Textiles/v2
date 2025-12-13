import Sidebar from "../components/sidebar/sidebar"
import MobileSidebarOverlay from "../components/mobile-sidebar-overlay"
import { TopNavbar } from "../components/top-navbar"

import { requireAuth } from "@/lib/auth-cookie"
import { getDetails, getPartnerStores } from "./actions"
import { TooltipProvider } from "@medusajs/ui"
import BackendHealthBanner from "../components/backend-health-banner"
import AuthLayer from "../components/auth-layer"

type Partner = Awaited<ReturnType<typeof getDetails>>
type SidebarPartner = (NonNullable<Partner> & { store_name?: string | null }) | null

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  await requireAuth() // Protect all dashboard routes
  const [partner, storesRes] = await Promise.all([
    getDetails(),
    getPartnerStores(),
  ])
  const storeName = storesRes?.stores?.[0]?.name ?? null

  const sidebarPartner: SidebarPartner = partner
    ? {
        ...partner,
        store_name: storeName,
      }
    : null
  // Show banner only when we couldn't fetch partner details
  const backendError = !partner

  return (
    <>
    {/* Unified auth layer: ensures 401/403 redirect and cookie clear */}
    <AuthLayer />
    <div className="flex h-screen w-full bg-ui-bg-subtle [--sidebar-width:0px] md:[--sidebar-width:14rem]">
      {sidebarPartner ? (
        <div className="hidden md:block h-full md:w-56 flex-shrink-0 border-r">
          <Sidebar partner={sidebarPartner} />
        </div>
      ) : (
        <div className="hidden md:block h-full md:w-56 flex-shrink-0 border-r" />
      )}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Mobile overlay toggle */}
        {sidebarPartner ? <MobileSidebarOverlay partner={sidebarPartner} /> : null}
        <TopNavbar />
        <TooltipProvider>
        <main className="flex-1 overflow-y-auto p-2">
          {/* Client banner controlled via server health check */}
          <BackendHealthBanner force={backendError} />
          {children}
        </main>
        </TooltipProvider>
      </div>
    </div>
    </>
  )
}
