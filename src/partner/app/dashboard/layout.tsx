import Sidebar from "../components/sidebar/sidebar"
import MobileSidebarOverlay from "../components/mobile-sidebar-overlay"
import { TopNavbar } from "../components/top-navbar"

import { requireAuth } from "@/lib/auth-cookie"
import { getDetails } from "./actions"
import { TooltipProvider } from "@medusajs/ui"
import BackendHealthBanner from "../components/backend-health-banner"
import TopLoader from "../components/top-loader"

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  await requireAuth() // Protect all dashboard routes
  const partner = await getDetails()
  // Show banner only when we couldn't fetch partner details
  const backendError = !partner

  return (
    <>
    <TopLoader />
    <div className="flex h-screen w-full bg-ui-bg-subtle [--sidebar-width:0px] md:[--sidebar-width:14rem]">
      {partner ? (
        <div className="hidden md:block h-full md:w-56 flex-shrink-0 border-r">
          <Sidebar partner={partner} />
        </div>
      ) : (
        <div className="hidden md:block h-full md:w-56 flex-shrink-0 border-r" />
      )}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Mobile overlay toggle */}
        {partner ? <MobileSidebarOverlay partner={partner} /> : null}
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
