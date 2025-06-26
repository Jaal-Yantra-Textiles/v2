import Sidebar from "../components/sidebar/sidebar"
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
    <div className="flex h-screen w-full bg-ui-bg-subtle">
      <div className="h-full w-56 flex-shrink-0 border-r">
        <Sidebar partner={partner} />
      </div>
      <div className="flex flex-1 flex-col overflow-hidden">
        <TopNavbar />
        <main className="flex-1 overflow-y-auto p-8">{children}</main>
      </div>
    </div>
  )
}
