import Sidebar from "../components/sidebar/sidebar"
import MobileSidebarOverlay from "../components/mobile-sidebar-overlay"
import { TopNavbar } from "../components/top-navbar"

import { requireAuth } from "@/lib/auth-cookie"
import { getDetails } from "./actions"

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  await requireAuth() // Protect all dashboard routes
  const partner = await getDetails()

  return (
    <div className="flex h-screen w-full bg-ui-bg-subtle [--sidebar-width:0px] md:[--sidebar-width:14rem]">
      <div className="hidden md:block h-full md:w-56 flex-shrink-0 border-r">
        <Sidebar partner={partner} />
      </div>
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Mobile overlay toggle */}
        <MobileSidebarOverlay partner={partner} />
        <TopNavbar />
        <main className="flex-1 overflow-y-auto p-8 pb-28">{children}</main>
      </div>
    </div>
  )
}
