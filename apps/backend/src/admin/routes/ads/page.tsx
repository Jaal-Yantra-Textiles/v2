import { defineRouteConfig } from "@medusajs/admin-sdk"
import { ChartBar } from "@medusajs/icons"
import { Heading, Text } from "@medusajs/ui"
import { Fragment, useEffect } from "react"
import { useSearchParams } from "react-router-dom"
import { type AdsPlatformKind, useAdsPlatforms } from "../../hooks/api/ads"
import { PlatformPicker } from "./_components/platform-picker"
import { SyncButton } from "./_components/sync-button"
import { AccountsTab } from "./_components/accounts-tab"
import { CampaignsTab } from "./_components/campaigns-tab"
import { AdGroupsTab } from "./_components/ad-groups-tab"
import { AdsTab } from "./_components/ads-tab"
import { InsightsTab } from "./_components/insights-tab"

const TAB_PARAM = "tab"
const DEFAULT_TAB = "accounts"
const PLATFORM_PARAM = "platform_id"
const PLATFORM_STORAGE_KEY = "jyt:ads:platform_id"

const TABS = [
  { value: "accounts", label: "Accounts" },
  { value: "campaigns", label: "Campaigns" },
  { value: "ad-groups", label: "Ad groups" },
  { value: "ads", label: "Ads" },
  { value: "insights", label: "Insights" },
]

const AdsPage = () => {
  const [searchParams, setSearchParams] = useSearchParams()
  const { data: platforms = [], isLoading: platformsLoading } = useAdsPlatforms()

  const activeTab = searchParams.get(TAB_PARAM) || DEFAULT_TAB
  const platformId =
    searchParams.get(PLATFORM_PARAM) ||
    (typeof window !== "undefined"
      ? window.localStorage.getItem(PLATFORM_STORAGE_KEY) || ""
      : "")

  // First mount: if no URL platform but localStorage has one, hoist it into
  // the URL so deep-links from this point onward are stable. If neither
  // has a value and we just loaded the platforms list, pick the first
  // available so the page renders something useful out of the box.
  useEffect(() => {
    if (searchParams.get(PLATFORM_PARAM)) return
    const stored =
      typeof window !== "undefined"
        ? window.localStorage.getItem(PLATFORM_STORAGE_KEY)
        : null
    if (stored && platforms.find((p) => p.id === stored)) {
      const next = new URLSearchParams(searchParams)
      next.set(PLATFORM_PARAM, stored)
      setSearchParams(next, { replace: true })
      return
    }
    if (!platformsLoading && platforms.length > 0) {
      const next = new URLSearchParams(searchParams)
      next.set(PLATFORM_PARAM, platforms[0].id)
      setSearchParams(next, { replace: true })
    }
  }, [platforms, platformsLoading, searchParams, setSearchParams])

  const platformKind: AdsPlatformKind | null =
    platforms.find((p) => p.id === platformId)?.kind || null

  const handleTabChange = (value: string) => {
    const next = new URLSearchParams(searchParams)
    next.set(TAB_PARAM, value)
    setSearchParams(next, { replace: true })
  }

  const handlePlatformChange = (id: string) => {
    const next = new URLSearchParams(searchParams)
    next.set(PLATFORM_PARAM, id)
    setSearchParams(next, { replace: true })
    if (typeof window !== "undefined") {
      window.localStorage.setItem(PLATFORM_STORAGE_KEY, id)
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 px-6 py-4">
        <div className="mr-auto">
          <Heading>Ads</Heading>
          <Text className="text-ui-fg-subtle" size="small">
            Unified view of Meta + Google Ads — accounts, campaigns, creatives, and historical performance.
          </Text>
        </div>
        <PlatformPicker value={platformId} onChange={handlePlatformChange} />
        <SyncButton platformId={platformId} kind={platformKind} />
      </div>

      <div className="flex flex-wrap items-center gap-2 px-6 pb-3">
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

      <div>
        {!platformId ? (
          <div className="px-6 py-12 text-center">
            <Text className="text-ui-fg-subtle">
              Pick an ads platform above to begin.
            </Text>
          </div>
        ) : (
          <>
            {activeTab === "accounts" && (
              <AccountsTab platformId={platformId} kind={platformKind} />
            )}
            {activeTab === "campaigns" && (
              <CampaignsTab platformId={platformId} kind={platformKind} />
            )}
            {activeTab === "ad-groups" && (
              <AdGroupsTab platformId={platformId} kind={platformKind} />
            )}
            {activeTab === "ads" && (
              <AdsTab platformId={platformId} kind={platformKind} />
            )}
            {activeTab === "insights" && (
              <InsightsTab platformId={platformId} kind={platformKind} />
            )}
          </>
        )}
      </div>
    </div>
  )
}

export const config = defineRouteConfig({
  label: "Ads",
  nested: "/promotions",
  icon: ChartBar,
})

export const handle = {
  breadcrumb: () => "Ads",
}

export default AdsPage
