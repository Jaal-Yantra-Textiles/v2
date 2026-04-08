import { defineRouteConfig } from "@medusajs/admin-sdk"
import { CurrencyDollar } from "@medusajs/icons"
import { Heading, Text } from "@medusajs/ui"
import { Fragment } from "react"
import { useSearchParams, Outlet } from "react-router-dom"
import { SubmissionsTab } from "./_components/submissions-tab"
import { ReconciliationTab } from "./_components/reconciliation-tab"

const TAB_PARAM = "tab"
const DEFAULT_TAB = "submissions"

const TABS = [
  { value: "submissions", label: "Submissions" },
  { value: "reconciliation", label: "Reconciliation" },
]

const PaymentSubmissionsPage = () => {
  const [searchParams, setSearchParams] = useSearchParams()
  const activeTab = searchParams.get(TAB_PARAM) || DEFAULT_TAB

  const handleTabChange = (value: string) => {
    setSearchParams({ [TAB_PARAM]: value }, { replace: true })
  }

  return (
    <div>
      <div className="flex items-center gap-3 px-6 py-4">
        <div>
          <Heading>Payment Submissions</Heading>
          <Text className="text-ui-fg-subtle" size="small">
            Manage design payment submissions and reconciliation
          </Text>
        </div>
        <div className="flex items-center gap-2">
          {TABS.map((tab, i) => (
            <Fragment key={tab.value}>
              {i > 0 && (
                <span className="text-ui-fg-muted text-xs select-none">|</span>
              )}
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
        {activeTab === "submissions" && <SubmissionsTab />}
        {activeTab === "reconciliation" && <ReconciliationTab />}
      </div>

      <Outlet />
    </div>
  )
}

export const config = defineRouteConfig({
  label: "Payment Submissions",
  icon: CurrencyDollar,
})

export const handle = {
  breadcrumb: () => "Payment Submissions",
}

export default PaymentSubmissionsPage
