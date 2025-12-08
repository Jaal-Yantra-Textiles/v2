import { 
  Container, 
  Heading, 
  Text, 
  StatusBadge, 
  Badge,
  Tabs,
  toast,
} from "@medusajs/ui"
import { useParams, LoaderFunctionArgs, UIMatch } from "react-router-dom"
import { 
  useAdCampaign, 
  AdCampaign, 
  useUpdateCampaignStatus,
} from "../../../../hooks/api/meta-ads"
import { useDefaultStore } from "../../../../hooks/api/stores"
import { TwoColumnPage } from "../../../../components/pages/two-column-pages"
import { TwoColumnPageSkeleton } from "../../../../components/table/skeleton"
import { ArrowUpRightOnBox, PlaySolid, PauseSolid } from "@medusajs/icons"
import { ActionMenu } from "../../../../components/common/action-menu"
import { useMemo } from "react"

// ============ Helper Functions ============

const formatCurrency = (value: number | null | undefined, currency = "USD"): string => {
  if (value === null || value === undefined) return "—"
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      minimumFractionDigits: 2,
    }).format(value)
  } catch {
    return `${currency} ${value.toFixed(2)}`
  }
}

const formatNumber = (value: number | null | undefined): string => {
  if (value === null || value === undefined) return "—"
  return new Intl.NumberFormat("en-US").format(value)
}

const formatPercent = (value: number | null | undefined): string => {
  if (value === null || value === undefined) return "—"
  return `${value.toFixed(2)}%`
}

const formatDate = (date: string | Date | null | undefined): string => {
  if (!date) return "—"
  return new Date(date).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  })
}

const getStatusBadgeColor = (status: string): "green" | "orange" | "red" | "grey" => {
  switch (status) {
    case "ACTIVE": return "green"
    case "PAUSED": return "orange"
    case "DELETED": return "red"
    case "ARCHIVED": return "grey"
    default: return "grey"
  }
}

// ============ Section Components ============

type CampaignOverviewSectionProps = {
  campaign: AdCampaign & { ad_sets?: any[]; ads?: any[] }
  currencyCode: string
  onStatusChange?: (status: "ACTIVE" | "PAUSED") => void
  isUpdatingStatus?: boolean
}

const CampaignOverviewSection = ({ campaign, currencyCode, onStatusChange, isUpdatingStatus }: CampaignOverviewSectionProps) => {
  const isActive = campaign.status === "ACTIVE"
  
  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <div>
          <div className="flex items-center gap-2">
            <Heading level="h1">{campaign.name}</Heading>
            <StatusBadge color={getStatusBadgeColor(campaign.status)}>
              {campaign.status}
            </StatusBadge>
          </div>
          {campaign.objective && campaign.objective !== "OTHER" && (
            <Badge size="small" color="grey" className="mt-2">
              {campaign.objective.replace("OUTCOME_", "").replace(/_/g, " ")}
            </Badge>
          )}
        </div>
        
        {/* Actions Menu */}
        {onStatusChange && (
          <ActionMenu
            groups={[
              {
                actions: [
                  isActive
                    ? {
                        label: isUpdatingStatus ? "Pausing..." : "Pause Campaign",
                        icon: <PauseSolid />,
                        onClick: () => onStatusChange("PAUSED"),
                        disabled: isUpdatingStatus,
                      }
                    : {
                        label: isUpdatingStatus ? "Resuming..." : "Resume Campaign",
                        icon: <PlaySolid />,
                        onClick: () => onStatusChange("ACTIVE"),
                        disabled: isUpdatingStatus,
                      },
                ],
              },
            ]}
          />
        )}
      </div>
      
      {/* Key Metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 px-6 py-4">
        <div>
          <Text size="small" className="text-ui-fg-subtle">Total Spend</Text>
          <Text className="text-xl font-semibold">{formatCurrency(campaign.spend, currencyCode)}</Text>
        </div>
        <div>
          <Text size="small" className="text-ui-fg-subtle">Impressions</Text>
          <Text className="text-xl font-semibold">{formatNumber(campaign.impressions)}</Text>
        </div>
        <div>
          <Text size="small" className="text-ui-fg-subtle">Clicks</Text>
          <Text className="text-xl font-semibold">{formatNumber(campaign.clicks)}</Text>
        </div>
        <div>
          <Text size="small" className="text-ui-fg-subtle">CTR</Text>
          <Text className="text-xl font-semibold">{formatPercent(campaign.ctr)}</Text>
        </div>
      </div>
      
      {/* Secondary Metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 px-6 py-4">
        <div>
          <Text size="small" className="text-ui-fg-subtle">Reach</Text>
          <Text className="text-lg font-medium">{formatNumber(campaign.reach)}</Text>
        </div>
        <div>
          <Text size="small" className="text-ui-fg-subtle">Leads</Text>
          <Text className="text-lg font-medium">{formatNumber(campaign.leads)}</Text>
        </div>
        <div>
          <Text size="small" className="text-ui-fg-subtle">Cost per Lead</Text>
          <Text className="text-lg font-medium">{formatCurrency(campaign.cost_per_lead, currencyCode)}</Text>
        </div>
        <div>
          <Text size="small" className="text-ui-fg-subtle">CPC</Text>
          <Text className="text-lg font-medium">{formatCurrency(campaign.cpc, currencyCode)}</Text>
        </div>
      </div>
    </Container>
  )
}

type CampaignDetailsSectionProps = {
  campaign: AdCampaign & { ad_sets?: any[]; ads?: any[] }
  currencyCode: string
}

const CampaignDetailsSection = ({ campaign, currencyCode }: CampaignDetailsSectionProps) => {
  return (
    <Container className="divide-y p-0">
      <div className="px-6 py-4">
        <Heading level="h2">Campaign Details</Heading>
      </div>
      
      <div className="px-6 py-4 space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Text size="small" className="text-ui-fg-subtle">Meta Campaign ID</Text>
            <Text className="font-mono text-sm">{campaign.meta_campaign_id}</Text>
          </div>
          <div>
            <Text size="small" className="text-ui-fg-subtle">Effective Status</Text>
            <Text>{campaign.effective_status || "—"}</Text>
          </div>
        </div>
        
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Text size="small" className="text-ui-fg-subtle">Daily Budget</Text>
            <Text>{campaign.daily_budget ? formatCurrency(campaign.daily_budget, currencyCode) : "—"}</Text>
          </div>
          <div>
            <Text size="small" className="text-ui-fg-subtle">Lifetime Budget</Text>
            <Text>{campaign.lifetime_budget ? formatCurrency(campaign.lifetime_budget, currencyCode) : "—"}</Text>
          </div>
        </div>
        
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Text size="small" className="text-ui-fg-subtle">CPM</Text>
            <Text>{formatCurrency(campaign.cpm, currencyCode)}</Text>
          </div>
          <div>
            <Text size="small" className="text-ui-fg-subtle">Last Synced</Text>
            <Text>{formatDate(campaign.last_synced_at)}</Text>
          </div>
        </div>
      </div>
    </Container>
  )
}

type AdSetsListSectionProps = {
  adSets: any[]
  currencyCode: string
}

const AdSetsListSection = ({ adSets, currencyCode }: AdSetsListSectionProps) => {
  if (!adSets || adSets.length === 0) {
    return (
      <Container className="divide-y p-0">
        <div className="px-6 py-4">
          <Heading level="h2">Ad Sets</Heading>
        </div>
        <div className="px-6 py-8 text-center">
          <Text className="text-ui-fg-subtle">No ad sets found. Sync campaigns to load ad sets.</Text>
        </div>
      </Container>
    )
  }

  return (
    <Container className="divide-y p-0">
      <div className="px-6 py-4">
        <Heading level="h2">Ad Sets ({adSets.length})</Heading>
      </div>
      
      <div className="divide-y">
        {adSets.map((adSet: any) => (
          <div key={adSet.id} className="px-6 py-4">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <Text className="font-medium">{adSet.name}</Text>
                <StatusBadge color={getStatusBadgeColor(adSet.status)}>
                  {adSet.status}
                </StatusBadge>
              </div>
            </div>
            
            <div className="grid grid-cols-4 gap-4 mt-3">
              <div>
                <Text size="xsmall" className="text-ui-fg-subtle">Spend</Text>
                <Text size="small">{formatCurrency(adSet.spend, currencyCode)}</Text>
              </div>
              <div>
                <Text size="xsmall" className="text-ui-fg-subtle">Impressions</Text>
                <Text size="small">{formatNumber(adSet.impressions)}</Text>
              </div>
              <div>
                <Text size="xsmall" className="text-ui-fg-subtle">Clicks</Text>
                <Text size="small">{formatNumber(adSet.clicks)}</Text>
              </div>
              <div>
                <Text size="xsmall" className="text-ui-fg-subtle">CTR</Text>
                <Text size="small">{formatPercent(adSet.ctr)}</Text>
              </div>
            </div>
          </div>
        ))}
      </div>
    </Container>
  )
}

type AdsListSectionProps = {
  ads: any[]
  currencyCode: string
}

const AdsListSection = ({ ads, currencyCode }: AdsListSectionProps) => {
  if (!ads || ads.length === 0) {
    return (
      <Container className="divide-y p-0">
        <div className="px-6 py-4">
          <Heading level="h2">Ads</Heading>
        </div>
        <div className="px-6 py-8 text-center">
          <Text className="text-ui-fg-subtle">No ads found. Sync campaigns to load ads.</Text>
        </div>
      </Container>
    )
  }

  return (
    <Container className="divide-y p-0">
      <div className="px-6 py-4">
        <Heading level="h2">Ads ({ads.length})</Heading>
      </div>
      
      <div className="divide-y">
        {ads.map((ad: any) => (
          <div key={ad.id} className="px-6 py-4">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <Text className="font-medium">{ad.name}</Text>
                <StatusBadge color={getStatusBadgeColor(ad.status)}>
                  {ad.status}
                </StatusBadge>
              </div>
              {ad.preview_url && (
                <a 
                  href={ad.preview_url} 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="text-ui-fg-interactive hover:text-ui-fg-interactive-hover"
                >
                  <ArrowUpRightOnBox className="w-4 h-4" />
                </a>
              )}
            </div>
            
            <div className="grid grid-cols-5 gap-4 mt-3">
              <div>
                <Text size="xsmall" className="text-ui-fg-subtle">Spend</Text>
                <Text size="small">{formatCurrency(ad.spend, currencyCode)}</Text>
              </div>
              <div>
                <Text size="xsmall" className="text-ui-fg-subtle">Impressions</Text>
                <Text size="small">{formatNumber(ad.impressions)}</Text>
              </div>
              <div>
                <Text size="xsmall" className="text-ui-fg-subtle">Clicks</Text>
                <Text size="small">{formatNumber(ad.clicks)}</Text>
              </div>
              <div>
                <Text size="xsmall" className="text-ui-fg-subtle">CTR</Text>
                <Text size="small">{formatPercent(ad.ctr)}</Text>
              </div>
              <div>
                <Text size="xsmall" className="text-ui-fg-subtle">Leads</Text>
                <Text size="small">{formatNumber(ad.leads)}</Text>
              </div>
            </div>
          </div>
        ))}
      </div>
    </Container>
  )
}

type InsightsSectionProps = {
  insights: any[]
  currencyCode: string
}

const InsightsSection = ({ insights, currencyCode }: InsightsSectionProps) => {
  if (!insights || insights.length === 0) {
    return (
      <Container className="divide-y p-0">
        <div className="px-6 py-4">
          <Heading level="h2">Historical Insights</Heading>
        </div>
        <div className="px-6 py-8 text-center">
          <Text className="text-ui-fg-subtle">No historical insights. Click "Sync Insights" to load data.</Text>
        </div>
      </Container>
    )
  }

  // Sort by date descending
  const sortedInsights = [...insights].sort((a, b) => 
    new Date(b.date_start).getTime() - new Date(a.date_start).getTime()
  )

  return (
    <Container className="divide-y p-0">
      <div className="px-6 py-4">
        <Heading level="h2">Historical Insights ({insights.length} days)</Heading>
      </div>
      
      {/* Table header */}
      <div className="grid grid-cols-7 gap-2 px-6 py-2 bg-ui-bg-subtle text-ui-fg-subtle">
        <Text size="xsmall" className="font-medium">Date</Text>
        <Text size="xsmall" className="font-medium text-right">Spend</Text>
        <Text size="xsmall" className="font-medium text-right">Impressions</Text>
        <Text size="xsmall" className="font-medium text-right">Reach</Text>
        <Text size="xsmall" className="font-medium text-right">Clicks</Text>
        <Text size="xsmall" className="font-medium text-right">CTR</Text>
        <Text size="xsmall" className="font-medium text-right">Leads</Text>
      </div>
      
      <div className="divide-y max-h-[400px] overflow-y-auto">
        {sortedInsights.map((insight: any, idx: number) => (
          <div key={insight.id || idx} className="grid grid-cols-7 gap-2 px-6 py-3">
            <Text size="small">{formatDate(insight.date_start)}</Text>
            <Text size="small" className="text-right">{formatCurrency(insight.spend, currencyCode)}</Text>
            <Text size="small" className="text-right">{formatNumber(insight.impressions)}</Text>
            <Text size="small" className="text-right">{formatNumber(insight.reach)}</Text>
            <Text size="small" className="text-right">{formatNumber(insight.clicks)}</Text>
            <Text size="small" className="text-right">{formatPercent(insight.ctr)}</Text>
            <Text size="small" className="text-right">{formatNumber(insight.leads)}</Text>
          </div>
        ))}
      </div>
    </Container>
  )
}

// ============ Summary Sidebar ============

type CampaignSummarySectionProps = {
  campaign: AdCampaign & { ad_sets?: any[]; ads?: any[] }
  currencyCode: string
}

const CampaignSummarySection = ({ campaign, currencyCode }: CampaignSummarySectionProps) => {
  const adSetsCount = campaign.ad_sets?.length || 0
  const adsCount = campaign.ads?.length || 0
  
  return (
    <Container className="divide-y p-0">
      <div className="px-6 py-4">
        <Heading level="h2">Summary</Heading>
      </div>
      
      <div className="px-6 py-4 space-y-4">
        <div className="flex items-center justify-between">
          <Text size="small" className="text-ui-fg-subtle">Status</Text>
          <StatusBadge color={getStatusBadgeColor(campaign.status)}>
            {campaign.status}
          </StatusBadge>
        </div>
        
        <div className="flex items-center justify-between">
          <Text size="small" className="text-ui-fg-subtle">Ad Sets</Text>
          <Text className="font-medium">{adSetsCount}</Text>
        </div>
        
        <div className="flex items-center justify-between">
          <Text size="small" className="text-ui-fg-subtle">Ads</Text>
          <Text className="font-medium">{adsCount}</Text>
        </div>
        
        <div className="flex items-center justify-between">
          <Text size="small" className="text-ui-fg-subtle">Total Spend</Text>
          <Text className="font-medium">{formatCurrency(campaign.spend, currencyCode)}</Text>
        </div>
        
        <div className="flex items-center justify-between">
          <Text size="small" className="text-ui-fg-subtle">Total Leads</Text>
          <Text className="font-medium">{formatNumber(campaign.leads)}</Text>
        </div>
      </div>
      
      {/* Quick Stats */}
      <div className="px-6 py-4">
        <Text size="small" className="text-ui-fg-subtle mb-3">Performance</Text>
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-ui-tag-green-icon" />
            <Text size="small">CTR: {formatPercent(campaign.ctr)}</Text>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-ui-tag-blue-icon" />
            <Text size="small">CPC: {formatCurrency(campaign.cpc, currencyCode)}</Text>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-ui-tag-orange-icon" />
            <Text size="small">CPL: {formatCurrency(campaign.cost_per_lead, currencyCode)}</Text>
          </div>
        </div>
      </div>
    </Container>
  )
}

// ============ Main Page Component ============

const CampaignDetailPage = () => {
  const { id } = useParams<{ id: string }>()
  
  const { data, isLoading, isError, error } = useAdCampaign(id!)
  const { store } = useDefaultStore()
  const updateCampaignStatus = useUpdateCampaignStatus()
  
  const defaultCurrency = useMemo(() => {
    const defaultCurrencyObj = store?.supported_currencies?.find(c => c.is_default)
    return defaultCurrencyObj?.currency_code?.toUpperCase() || "USD"
  }, [store])

  const handleStatusChange = (status: "ACTIVE" | "PAUSED") => {
    updateCampaignStatus.mutate(
      { id: id!, status },
      {
        onSuccess: () => {
          toast.success(`Campaign ${status === "ACTIVE" ? "resumed" : "paused"} successfully`)
        },
        onError: (err: any) => {
          toast.error(err.message || "Failed to update campaign status")
        },
      }
    )
  }

  if (isLoading) {
    return <TwoColumnPageSkeleton showJSON={false} showMetadata={false} mainSections={3} sidebarSections={2} />
  }

  if (isError || !data?.campaign) {
    return (
      <Container className="p-6">
        <Text className="text-ui-fg-error">
          {(error as any)?.message || "Campaign not found"}
        </Text>
      </Container>
    )
  }

  const campaign = data.campaign as AdCampaign & { ad_sets?: any[]; ads?: any[]; insights?: any[] }

  return (
    <TwoColumnPage data={campaign} showJSON={true} showMetadata={false}>
      {/* Main Content */}
      <TwoColumnPage.Main>
        <CampaignOverviewSection 
          campaign={campaign} 
          currencyCode={defaultCurrency}
          onStatusChange={handleStatusChange}
          isUpdatingStatus={updateCampaignStatus.isPending}
        />
        
        <Tabs defaultValue="adsets" className="mt-6">
          <Tabs.List>
            <Tabs.Trigger value="adsets">Ad Sets ({campaign.ad_sets?.length || 0})</Tabs.Trigger>
            <Tabs.Trigger value="ads">Ads ({campaign.ads?.length || 0})</Tabs.Trigger>
            <Tabs.Trigger value="insights">Insights</Tabs.Trigger>
          </Tabs.List>
          
          <Tabs.Content value="adsets" className="mt-4">
            <AdSetsListSection adSets={campaign.ad_sets || []} currencyCode={defaultCurrency} />
          </Tabs.Content>
          
          <Tabs.Content value="ads" className="mt-4">
            <AdsListSection ads={campaign.ads || []} currencyCode={defaultCurrency} />
          </Tabs.Content>
          
          <Tabs.Content value="insights" className="mt-4">
            <InsightsSection insights={campaign.insights || []} currencyCode={defaultCurrency} />
          </Tabs.Content>
        </Tabs>
      </TwoColumnPage.Main>
      
      {/* Sidebar */}
      <TwoColumnPage.Sidebar>
        <CampaignSummarySection campaign={campaign} currencyCode={defaultCurrency} />
        <CampaignDetailsSection campaign={campaign} currencyCode={defaultCurrency} />
      </TwoColumnPage.Sidebar>
    </TwoColumnPage>
  )
}

export const handle = {
  breadcrumb: (match: UIMatch<{ id: string }>) => {
    return match.params.id || "Campaign"
  },
}

export async function loader(args: LoaderFunctionArgs) {
  const { campaignDetailLoader } = await import("./loader")
  return campaignDetailLoader(args)
}

export default CampaignDetailPage
