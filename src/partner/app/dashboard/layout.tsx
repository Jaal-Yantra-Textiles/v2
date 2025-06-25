import { Sidebar } from "../components/sidebar/sidebar"
import { TopNavbar } from "../components/top-navbar"

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="flex h-screen w-full bg-ui-bg-base">
      <div className="h-full w-56 flex-shrink-0 border-r">
        <Sidebar />
      </div>
      <div className="flex flex-1 flex-col overflow-hidden">
        <TopNavbar />
        <main className="flex-1 overflow-y-auto p-8">{children}</main>
      </div>
    </div>
  )
}
