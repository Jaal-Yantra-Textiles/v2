import { defineRouteConfig } from "@medusajs/admin-sdk"
import { CurrencyDollar } from "@medusajs/icons"
import { Heading, Text } from "@medusajs/ui"
import { Fragment } from "react"
import { useSearchParams, Outlet } from "react-router-dom"
import { SavedReportsTab } from "./_components/saved-reports-tab"
import { LiveSummaryTab } from "./_components/live-summary-tab"
import { ByPartnerTab } from "./_components/by-partner-tab"
import { ByPersonTab } from "./_components/by-person-tab"

const TAB_PARAM = "tab"
const DEFAULT_TAB = "saved"

const TABS = [
  { value: "saved", label: "Saved Reports" },
  { value: "summary", label: "Live Summary" },
  { value: "by-partner", label: "By Partner" },
  { value: "by-person", label: "By Person" },
]

const PaymentReportsPage = () => {
  const [searchParams, setSearchParams] = useSearchParams()
  const activeTab = searchParams.get(TAB_PARAM) || DEFAULT_TAB

  const handleTabChange = (value: string) => {
    setSearchParams({ [TAB_PARAM]: value }, { replace: true })
  }

  return (
    <div>
      <div className="flex items-center gap-3 px-6 py-4">
        <div>
          <Heading>Payment Reports</Heading>
          <Text className="text-ui-fg-subtle" size="small">
            View saved report snapshots and live payment aggregates
          </Text>
        </div>
        <div className="flex items-center gap-2">
          {TABS.map((tab, i) => (
            <Fragment key={tab.value}>
              {i > 0 && <span className="text-ui-fg-muted text-xs select-none">|</span>}
              <button
                type="button"
                onClick={() => handleTabChange(tab.value)}
                className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
                  activeTab === tab.value
                    ? "border-ui-border-strong bg-ui-bg-subtle text-ui-fg-base"
                    : "border-transparent bg-ui-bg-base text-ui-fg-subtle hover:text-ui-fg-base"
                }`}
              >
                {tab.label}
              </button>
            </Fragment>
          ))}
        </div>
      </div>

      <div>
        {activeTab === "saved" && <SavedReportsTab />}
        {activeTab === "summary" && <LiveSummaryTab />}
        {activeTab === "by-partner" && <ByPartnerTab />}
        {activeTab === "by-person" && <ByPersonTab />}
      </div>

      <Outlet />
    </div>
  )
}

export const config = defineRouteConfig({
  label: "Payment Reports",
  icon: CurrencyDollar,
})

export const handle = {
  breadcrumb: () => "Payment Reports",
}

export default PaymentReportsPage
