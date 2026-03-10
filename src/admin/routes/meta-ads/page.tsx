import { Tabs } from "@medusajs/ui"
import { defineRouteConfig } from "@medusajs/admin-sdk"
import { ChartBar } from "@medusajs/icons"
import { useSearchParams } from "react-router-dom"
import { OverviewTab } from "./_components/overview-tab"
import { CampaignsTab } from "./_components/campaigns-tab"
import { LeadsTab } from "./_components/leads-tab"

const TAB_PARAM = "tab"
const DEFAULT_TAB = "overview"

const MetaAdsPage = () => {
  const [searchParams, setSearchParams] = useSearchParams()
  const activeTab = searchParams.get(TAB_PARAM) || DEFAULT_TAB

  const handleTabChange = (value: string) => {
    setSearchParams({ [TAB_PARAM]: value }, { replace: true })
  }

  return (
    <Tabs value={activeTab} onValueChange={handleTabChange}>
      <div className="px-4 md:px-6 pt-4 border-b border-ui-border-base bg-ui-bg-base sticky top-0 z-10">
        <Tabs.List>
          <Tabs.Trigger value="overview">Overview</Tabs.Trigger>
          <Tabs.Trigger value="campaigns">Campaigns</Tabs.Trigger>
          <Tabs.Trigger value="leads">Leads</Tabs.Trigger>
        </Tabs.List>
      </div>
      <Tabs.Content value="overview" className="mt-0">
        <OverviewTab />
      </Tabs.Content>
      <Tabs.Content value="campaigns" className="mt-0">
        <CampaignsTab />
      </Tabs.Content>
      <Tabs.Content value="leads" className="mt-0">
        <LeadsTab />
      </Tabs.Content>
    </Tabs>
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
