import { defineRouteConfig } from "@medusajs/admin-sdk"
import { ChartBar } from "@medusajs/icons"
import { Heading, Text } from "@medusajs/ui"
import { Fragment } from "react"
import { useSearchParams } from "react-router-dom"
import { OverviewTab } from "./_components/overview-tab"
import { CampaignsTab } from "./_components/campaigns-tab"
import { LeadsTab } from "./_components/leads-tab"

const TAB_PARAM = "tab"
const DEFAULT_TAB = "overview"

const TABS = [
  { value: "overview", label: "Overview" },
  { value: "campaigns", label: "Campaigns" },
  { value: "leads", label: "Leads" },
]

const MetaAdsPage = () => {
  const [searchParams, setSearchParams] = useSearchParams()
  const activeTab = searchParams.get(TAB_PARAM) || DEFAULT_TAB

  const handleTabChange = (value: string) => {
    setSearchParams({ [TAB_PARAM]: value }, { replace: true })
  }

  return (
    <div>
      <div className="flex items-center gap-3 px-6 py-4">
        <div>
          <Heading>Meta Ads</Heading>
          <Text className="text-ui-fg-subtle" size="small">
            Manage your Meta advertising campaigns and leads
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
        {activeTab === "overview" && <OverviewTab />}
        {activeTab === "campaigns" && <CampaignsTab />}
        {activeTab === "leads" && <LeadsTab />}
      </div>
    </div>
  )
}

export const config = defineRouteConfig({
  label: "Meta Ads",
  nested: "/promotions",
  icon: ChartBar,
})

export const handle = {
  breadcrumb: () => "Meta Ads",
}

export default MetaAdsPage
