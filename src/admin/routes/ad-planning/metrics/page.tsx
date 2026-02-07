/**
 * Ad Planning Metrics - RouteFocusModal
 * Consolidated metrics overview across all ad-planning modules
 */

import { Container, Text, Badge } from "@medusajs/ui"
import { useQuery } from "@tanstack/react-query"
import { Link } from "react-router-dom"
import { sdk } from "../../../lib/config"
import { RouteFocusModal } from "../../../components/modal/route-focus-modal"

// --- Reusable Components ---

const MetricCard = ({
  title,
  value,
  className,
}: {
  title: string
  value: string | number
  className?: string
}) => (
  <div className="shadow-elevation-card-rest bg-ui-bg-component rounded-lg p-4">
    <Text size="small" leading="compact" className="text-ui-fg-subtle">
      {title}
    </Text>
    <Text
      size="xlarge"
      leading="compact"
      weight="plus"
      className={`mt-1 ${className || ""}`}
    >
      {value}
    </Text>
  </div>
)

const SectionHeader = ({
  title,
  linkTo,
  linkLabel = "View all",
}: {
  title: string
  linkTo: string
  linkLabel?: string
}) => (
  <div className="flex items-center justify-between px-6 py-4 border-b border-ui-border-base">
    <Text size="small" leading="compact" weight="plus">
      {title}
    </Text>
    <Link to={linkTo} className="hover:underline">
      <Text size="small" leading="compact" className="text-ui-fg-interactive">
        {linkLabel}
      </Text>
    </Link>
  </div>
)

// --- Metrics Modal ---

const MetricsModal = () => {
  // Conversion stats
  const { data: conversionStats } = useQuery({
    queryKey: ["ad-planning", "conversions", "stats"],
    queryFn: async () => {
      const res = await sdk.client.fetch<any>(
        "/admin/ad-planning/conversions/stats"
      )
      return res
    },
  })

  // Experiments
  const { data: experimentsData } = useQuery({
    queryKey: ["ad-planning", "experiments", "dashboard"],
    queryFn: async () => {
      const res = await sdk.client.fetch<any>(
        "/admin/ad-planning/experiments?limit=5"
      )
      return res
    },
  })

  // Segments
  const { data: segmentsData } = useQuery({
    queryKey: ["ad-planning", "segments", "dashboard"],
    queryFn: async () => {
      const res = await sdk.client.fetch<any>(
        "/admin/ad-planning/segments?limit=50"
      )
      return res
    },
  })

  // Funnel
  const { data: journeyStats } = useQuery({
    queryKey: ["ad-planning", "journeys", "funnel"],
    queryFn: async () => {
      const res = await sdk.client.fetch<any>(
        "/admin/ad-planning/journeys/funnel"
      )
      return res
    },
  })

  // Scores
  const { data: tierStats } = useQuery({
    queryKey: ["ad-planning", "scores", "tiers"],
    queryFn: async () => {
      const res = await sdk.client.fetch<any>(
        "/admin/ad-planning/scores/tier-distribution"
      )
      return res
    },
  })

  // Attribution
  const { data: attrSummary } = useQuery({
    queryKey: ["ad-planning", "attribution", "summary"],
    queryFn: async () => {
      const res = await sdk.client.fetch<any>(
        "/admin/ad-planning/attribution/summary"
      )
      return res
    },
  })

  // Meta Ads - Campaign Totals
  const { data: campaignTotals } = useQuery({
    queryKey: ["meta-ads", "campaigns", "totals", "metrics"],
    queryFn: async () => {
      const res = await sdk.client.fetch<{
        totals: {
          spend: number
          impressions: number
          clicks: number
          leads: number
          reach: number
          conversions: number
          ctr: number
          cpc: number
          cpm: number
          cpl: number
          cpa: number
          campaign_count: number
        }
      }>("/admin/meta-ads/campaigns/totals")
      return res.totals
    },
  })

  // Meta Ads - Top Campaigns
  const { data: topCampaigns } = useQuery({
    queryKey: ["meta-ads", "campaigns", "metrics-top"],
    queryFn: async () => {
      const res = await sdk.client.fetch<{
        campaigns: any[]
        count: number
      }>("/admin/meta-ads/campaigns?limit=5")
      return res
    },
  })

  // Social Posts
  const { data: socialPostsData } = useQuery({
    queryKey: ["social-posts", "metrics-summary"],
    queryFn: async () => {
      const res = await sdk.client.fetch<{
        socialPosts: any[]
        count: number
      }>("/admin/social-posts?limit=100")
      return res
    },
  })

  // Meta Ads - Leads
  const { data: leadsData } = useQuery({
    queryKey: ["meta-ads", "leads", "metrics-summary"],
    queryFn: async () => {
      const res = await sdk.client.fetch<{
        leads: any[]
        count: number
        total: number
      }>("/admin/meta-ads/leads?limit=100")
      return res
    },
  })

  // Derived values
  const totalConversions = conversionStats?.total_conversions || 0
  const totalRevenue = conversionStats?.total_value || 0
  const conversionRate = conversionStats?.conversion_rate || 0

  const activeExperiments =
    experimentsData?.experiments?.filter((e: any) => e.status === "running")
      .length || 0
  const completedExperiments =
    experimentsData?.experiments?.filter((e: any) => e.status === "completed")
      .length || 0

  const totalSegments = segmentsData?.count || 0
  const activeSegments =
    segmentsData?.segments?.filter((s: any) => s.status === "active").length ||
    0
  const totalMembers =
    segmentsData?.segments?.reduce(
      (acc: number, s: any) => acc + (s.member_count || 0),
      0
    ) || 0

  const funnel = journeyStats?.funnel || []

  const distribution = tierStats?.distribution || []
  const totalScored = distribution.reduce(
    (acc: number, t: any) => acc + t.count,
    0
  )

  const totalAttributions = attrSummary?.total || 0
  const attrConversionRate =
    totalAttributions > 0
      ? ((attrSummary?.converted || 0) / totalAttributions) * 100
      : 0

  // Meta Ads derived
  const totalSpend = campaignTotals?.spend || 0
  const totalImpressions = campaignTotals?.impressions || 0
  const totalClicks = campaignTotals?.clicks || 0
  const totalAdLeads = campaignTotals?.leads || 0
  const avgCTR = campaignTotals?.ctr || 0
  const avgCPC = campaignTotals?.cpc || 0

  // ROAS (Return on Ad Spend)
  const revenueInCurrency = totalRevenue / 100
  const roas = totalSpend > 0 ? revenueInCurrency / totalSpend : 0

  // Social posts derived
  const posts = socialPostsData?.socialPosts || []
  const postedCount = posts.filter((p: any) => p.status === "posted").length
  const scheduledCount = posts.filter(
    (p: any) => p.status === "scheduled"
  ).length
  const failedCount = posts.filter((p: any) => p.status === "failed").length
  const draftCount = posts.filter((p: any) => p.status === "draft").length

  // Leads derived
  const leads = leadsData?.leads || []
  const totalLeads = leadsData?.total || leads.length
  const newLeads = leads.filter((l: any) => l.status === "new").length
  const qualifiedLeads = leads.filter(
    (l: any) => l.status === "qualified"
  ).length
  const convertedLeads = leads.filter(
    (l: any) => l.status === "converted"
  ).length
  const contactedLeads = leads.filter(
    (l: any) => l.status === "contacted"
  ).length

  const getFunnelConversion = (fromStage: string, toStage: string) => {
    const from = funnel.find((f: any) => f.stage === fromStage)?.count || 0
    const to = funnel.find((f: any) => f.stage === toStage)?.count || 0
    if (from === 0) return 0
    return ((to / from) * 100).toFixed(1)
  }

  return (
    <RouteFocusModal prev="/ad-planning">
      <RouteFocusModal.Header />
      <RouteFocusModal.Body className="overflow-y-auto">
        <div className="flex flex-col gap-y-6 p-6">
          {/* Title */}
          <div>
            <Text size="xlarge" leading="compact" weight="plus">
              Metrics Overview
            </Text>
            <Text
              size="small"
              leading="compact"
              className="text-ui-fg-subtle mt-1"
            >
              Consolidated metrics across ad spend, social content, leads,
              conversions, experiments, segments, journeys, scores, and
              attribution
            </Text>
          </div>

          {/* Overview KPIs */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
            <MetricCard
              title="Ad Spend"
              value={`₹${totalSpend.toLocaleString()}`}
              className="text-ui-fg-error"
            />
            <MetricCard
              title="Total Revenue"
              value={`₹${(totalRevenue / 100).toLocaleString()}`}
              className="text-ui-fg-positive"
            />
            <MetricCard
              title="Total Conversions"
              value={totalConversions.toLocaleString()}
            />
            <MetricCard
              title="Total Leads"
              value={totalLeads.toLocaleString()}
            />
            <MetricCard
              title="Social Posts"
              value={postedCount.toLocaleString()}
            />
            <MetricCard
              title="ROAS"
              value={`${roas.toFixed(2)}x`}
              className={roas >= 1 ? "text-ui-fg-positive" : "text-ui-fg-error"}
            />
          </div>

          {/* Meta Ads Spend */}
          <Container className="p-0">
            <SectionHeader
              title="Meta Ads Performance"
              linkTo="/meta-ads/campaigns"
            />
            <div className="px-6 py-4">
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-4">
                <div className="p-3 bg-ui-bg-subtle rounded-lg text-center">
                  <Text size="xsmall" className="text-ui-fg-muted">
                    Spend
                  </Text>
                  <Text size="large" weight="plus" className="mt-1">
                    ₹{totalSpend.toLocaleString()}
                  </Text>
                </div>
                <div className="p-3 bg-ui-bg-subtle rounded-lg text-center">
                  <Text size="xsmall" className="text-ui-fg-muted">
                    Impressions
                  </Text>
                  <Text size="large" weight="plus" className="mt-1">
                    {totalImpressions.toLocaleString()}
                  </Text>
                </div>
                <div className="p-3 bg-ui-bg-subtle rounded-lg text-center">
                  <Text size="xsmall" className="text-ui-fg-muted">
                    Clicks
                  </Text>
                  <Text size="large" weight="plus" className="mt-1">
                    {totalClicks.toLocaleString()}
                  </Text>
                </div>
                <div className="p-3 bg-ui-bg-subtle rounded-lg text-center">
                  <Text size="xsmall" className="text-ui-fg-muted">
                    Leads
                  </Text>
                  <Text size="large" weight="plus" className="mt-1">
                    {totalAdLeads.toLocaleString()}
                  </Text>
                </div>
                <div className="p-3 bg-ui-bg-subtle rounded-lg text-center">
                  <Text size="xsmall" className="text-ui-fg-muted">
                    CTR
                  </Text>
                  <Text size="large" weight="plus" className="mt-1">
                    {avgCTR.toFixed(2)}%
                  </Text>
                </div>
                <div className="p-3 bg-ui-bg-subtle rounded-lg text-center">
                  <Text size="xsmall" className="text-ui-fg-muted">
                    ROAS
                  </Text>
                  <Text
                    size="large"
                    weight="plus"
                    className={`mt-1 ${roas >= 1 ? "text-ui-fg-positive" : "text-ui-fg-error"}`}
                  >
                    {roas.toFixed(2)}x
                  </Text>
                </div>
              </div>

              {/* Top campaigns */}
              {topCampaigns?.campaigns?.length > 0 && (
                <div className="divide-y divide-ui-border-base rounded-lg border border-ui-border-base">
                  {topCampaigns.campaigns
                    .sort((a: any, b: any) => (b.spend || 0) - (a.spend || 0))
                    .slice(0, 3)
                    .map((c: any) => (
                      <Link
                        key={c.id}
                        to={`/meta-ads/campaigns/${c.id}`}
                        className="block px-4 py-3 hover:bg-ui-bg-base-hover transition-colors first:rounded-t-lg last:rounded-b-lg"
                      >
                        <div className="flex items-center justify-between">
                          <div>
                            <Text
                              size="small"
                              leading="compact"
                              weight="plus"
                            >
                              {c.name}
                            </Text>
                            <Text
                              size="xsmall"
                              leading="compact"
                              className="text-ui-fg-subtle"
                            >
                              ₹{(c.spend || 0).toLocaleString()} spent
                              · {(c.clicks || 0).toLocaleString()} clicks
                              · {(c.leads || 0).toLocaleString()} leads
                            </Text>
                          </div>
                          <Badge
                            color={
                              c.status === "ACTIVE"
                                ? "green"
                                : c.status === "PAUSED"
                                  ? "orange"
                                  : "grey"
                            }
                            size="xsmall"
                          >
                            {c.status}
                          </Badge>
                        </div>
                      </Link>
                    ))}
                </div>
              )}
            </div>
          </Container>

          {/* Social Content & Lead Pipeline (side by side) */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Social Content */}
            <Container className="p-0">
              <SectionHeader
                title="Social Content"
                linkTo="/social-posts"
              />
              <div className="px-6 py-4">
                <div className="grid grid-cols-2 gap-3 mb-4">
                  <div className="p-3 bg-ui-bg-subtle rounded-lg">
                    <Text size="xsmall" className="text-ui-fg-muted">
                      Posted
                    </Text>
                    <Text
                      size="large"
                      weight="plus"
                      className="mt-1 text-ui-fg-positive"
                    >
                      {postedCount}
                    </Text>
                  </div>
                  <div className="p-3 bg-ui-bg-subtle rounded-lg">
                    <Text size="xsmall" className="text-ui-fg-muted">
                      Scheduled
                    </Text>
                    <Text size="large" weight="plus" className="mt-1">
                      {scheduledCount}
                    </Text>
                  </div>
                  <div className="p-3 bg-ui-bg-subtle rounded-lg">
                    <Text size="xsmall" className="text-ui-fg-muted">
                      Drafts
                    </Text>
                    <Text size="large" weight="plus" className="mt-1">
                      {draftCount}
                    </Text>
                  </div>
                  <div className="p-3 bg-ui-bg-subtle rounded-lg">
                    <Text size="xsmall" className="text-ui-fg-muted">
                      Failed
                    </Text>
                    <Text
                      size="large"
                      weight="plus"
                      className={`mt-1 ${failedCount > 0 ? "text-ui-fg-error" : ""}`}
                    >
                      {failedCount}
                    </Text>
                  </div>
                </div>

                {/* Recent posted items */}
                {posts.filter((p: any) => p.status === "posted").length > 0 && (
                  <div className="divide-y divide-ui-border-base rounded-lg border border-ui-border-base">
                    {posts
                      .filter((p: any) => p.status === "posted")
                      .sort(
                        (a: any, b: any) =>
                          new Date(b.posted_at || b.updated_at).getTime() -
                          new Date(a.posted_at || a.updated_at).getTime()
                      )
                      .slice(0, 3)
                      .map((p: any) => (
                        <Link
                          key={p.id}
                          to={`/social-posts/${p.id}`}
                          className="block px-4 py-3 hover:bg-ui-bg-base-hover transition-colors first:rounded-t-lg last:rounded-b-lg"
                        >
                          <Text size="small" leading="compact" weight="plus">
                            {p.name}
                          </Text>
                          <Text
                            size="xsmall"
                            leading="compact"
                            className="text-ui-fg-subtle"
                          >
                            {p.posted_at
                              ? new Date(p.posted_at).toLocaleDateString()
                              : ""}
                            {p.caption
                              ? ` · ${p.caption.slice(0, 40)}${p.caption.length > 40 ? "..." : ""}`
                              : ""}
                          </Text>
                        </Link>
                      ))}
                  </div>
                )}
              </div>
            </Container>

            {/* Lead Pipeline */}
            <Container className="p-0">
              <SectionHeader
                title="Lead Pipeline"
                linkTo="/meta-ads/leads"
              />
              <div className="px-6 py-4">
                <div className="grid grid-cols-2 gap-3 mb-4">
                  <div className="p-3 bg-ui-bg-subtle rounded-lg">
                    <Text size="xsmall" className="text-ui-fg-muted">
                      New
                    </Text>
                    <Text
                      size="large"
                      weight="plus"
                      className="mt-1 text-ui-fg-interactive"
                    >
                      {newLeads}
                    </Text>
                  </div>
                  <div className="p-3 bg-ui-bg-subtle rounded-lg">
                    <Text size="xsmall" className="text-ui-fg-muted">
                      Contacted
                    </Text>
                    <Text size="large" weight="plus" className="mt-1">
                      {contactedLeads}
                    </Text>
                  </div>
                  <div className="p-3 bg-ui-bg-subtle rounded-lg">
                    <Text size="xsmall" className="text-ui-fg-muted">
                      Qualified
                    </Text>
                    <Text
                      size="large"
                      weight="plus"
                      className="mt-1 text-ui-fg-positive"
                    >
                      {qualifiedLeads}
                    </Text>
                  </div>
                  <div className="p-3 bg-ui-bg-subtle rounded-lg">
                    <Text size="xsmall" className="text-ui-fg-muted">
                      Converted
                    </Text>
                    <Text
                      size="large"
                      weight="plus"
                      className="mt-1 text-ui-fg-positive"
                    >
                      {convertedLeads}
                    </Text>
                  </div>
                </div>

                {/* Lead pipeline bar */}
                {totalLeads > 0 && (
                  <div>
                    <div className="flex items-center gap-1 mb-2 h-6">
                      {newLeads > 0 && (
                        <div
                          className="h-full bg-ui-tag-blue-bg rounded"
                          style={{
                            width: `${Math.max((newLeads / totalLeads) * 100, 5)}%`,
                          }}
                          title={`New: ${newLeads}`}
                        />
                      )}
                      {contactedLeads > 0 && (
                        <div
                          className="h-full bg-ui-tag-orange-bg rounded"
                          style={{
                            width: `${Math.max((contactedLeads / totalLeads) * 100, 5)}%`,
                          }}
                          title={`Contacted: ${contactedLeads}`}
                        />
                      )}
                      {qualifiedLeads > 0 && (
                        <div
                          className="h-full bg-ui-tag-green-bg rounded"
                          style={{
                            width: `${Math.max((qualifiedLeads / totalLeads) * 100, 5)}%`,
                          }}
                          title={`Qualified: ${qualifiedLeads}`}
                        />
                      )}
                      {convertedLeads > 0 && (
                        <div
                          className="h-full bg-ui-tag-purple-bg rounded"
                          style={{
                            width: `${Math.max((convertedLeads / totalLeads) * 100, 5)}%`,
                          }}
                          title={`Converted: ${convertedLeads}`}
                        />
                      )}
                    </div>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1">
                        <Badge color="blue" size="xsmall">
                          New
                        </Badge>
                        <Text size="xsmall" className="text-ui-fg-subtle">
                          {newLeads}
                        </Text>
                      </div>
                      <div className="flex items-center gap-1">
                        <Badge color="orange" size="xsmall">
                          Contacted
                        </Badge>
                        <Text size="xsmall" className="text-ui-fg-subtle">
                          {contactedLeads}
                        </Text>
                      </div>
                      <div className="flex items-center gap-1">
                        <Badge color="green" size="xsmall">
                          Qualified
                        </Badge>
                        <Text size="xsmall" className="text-ui-fg-subtle">
                          {qualifiedLeads}
                        </Text>
                      </div>
                      <div className="flex items-center gap-1">
                        <Badge color="purple" size="xsmall">
                          Converted
                        </Badge>
                        <Text size="xsmall" className="text-ui-fg-subtle">
                          {convertedLeads}
                        </Text>
                      </div>
                    </div>
                  </div>
                )}

                {/* Lead breakdown by campaign */}
                {leads.length > 0 && (() => {
                  const byCampaign = leads.reduce(
                    (acc: Record<string, number>, l: any) => {
                      const name = l.campaign_name || "Unknown Campaign"
                      acc[name] = (acc[name] || 0) + 1
                      return acc
                    },
                    {}
                  )
                  const sorted = Object.entries(byCampaign)
                    .sort(([, a], [, b]) => (b as number) - (a as number))
                    .slice(0, 5)

                  return sorted.length > 0 ? (
                    <div className="mt-4">
                      <Text
                        size="xsmall"
                        weight="plus"
                        className="text-ui-fg-subtle mb-2"
                      >
                        Top Campaigns by Leads
                      </Text>
                      <div className="divide-y divide-ui-border-base rounded-lg border border-ui-border-base">
                        {sorted.map(([name, count]) => (
                          <div
                            key={name}
                            className="flex items-center justify-between px-3 py-2"
                          >
                            <Text size="xsmall" leading="compact">
                              {name}
                            </Text>
                            <Badge color="blue" size="xsmall">
                              {count as number}
                            </Badge>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null
                })()}
              </div>
            </Container>
          </div>

          {/* Conversions Breakdown */}
          <Container className="p-0">
            <SectionHeader
              title="Conversions"
              linkTo="/ad-planning/conversions"
            />
            <div className="px-6 py-4">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="p-3 bg-ui-bg-subtle rounded-lg">
                  <Text size="xsmall" className="text-ui-fg-muted">
                    Purchases
                  </Text>
                  <Text size="large" weight="plus" className="mt-1">
                    {(
                      conversionStats?.by_type?.purchase || 0
                    ).toLocaleString()}
                  </Text>
                </div>
                <div className="p-3 bg-ui-bg-subtle rounded-lg">
                  <Text size="xsmall" className="text-ui-fg-muted">
                    Lead Forms
                  </Text>
                  <Text size="large" weight="plus" className="mt-1">
                    {(
                      conversionStats?.by_type?.lead_form_submission || 0
                    ).toLocaleString()}
                  </Text>
                </div>
                <div className="p-3 bg-ui-bg-subtle rounded-lg">
                  <Text size="xsmall" className="text-ui-fg-muted">
                    Add to Cart
                  </Text>
                  <Text size="large" weight="plus" className="mt-1">
                    {(
                      conversionStats?.by_type?.add_to_cart || 0
                    ).toLocaleString()}
                  </Text>
                </div>
                <div className="p-3 bg-ui-bg-subtle rounded-lg">
                  <Text size="xsmall" className="text-ui-fg-muted">
                    Begin Checkout
                  </Text>
                  <Text size="large" weight="plus" className="mt-1">
                    {(
                      conversionStats?.by_type?.begin_checkout || 0
                    ).toLocaleString()}
                  </Text>
                </div>
              </div>
            </div>
          </Container>

          {/* Customer Funnel */}
          {funnel.length > 0 && (
            <Container className="p-0">
              <SectionHeader
                title="Customer Funnel"
                linkTo="/ad-planning/journeys"
              />
              <div className="px-6 py-6">
                <div className="flex items-end justify-between gap-4">
                  {funnel.map((stage: any, index: number) => {
                    const maxCount = Math.max(
                      ...funnel.map((f: any) => f.count)
                    )
                    const heightPercent =
                      maxCount > 0 ? (stage.count / maxCount) * 100 : 0

                    return (
                      <div
                        key={stage.stage}
                        className="flex-1 flex flex-col items-center"
                      >
                        <div className="w-full flex flex-col items-center mb-2">
                          <Text size="small" weight="plus" className="mb-1">
                            {stage.count.toLocaleString()}
                          </Text>
                          <div
                            className="w-full bg-ui-bg-interactive rounded-t-md transition-all"
                            style={{
                              height: `${Math.max(heightPercent, 10)}px`,
                              minHeight: "20px",
                              maxHeight: "120px",
                            }}
                          />
                        </div>
                        <Text
                          size="xsmall"
                          className="text-ui-fg-subtle capitalize text-center"
                        >
                          {stage.stage}
                        </Text>
                        {index < funnel.length - 1 && (
                          <Text
                            size="xsmall"
                            className="text-ui-fg-muted mt-1"
                          >
                            {getFunnelConversion(
                              stage.stage,
                              funnel[index + 1].stage
                            )}
                            % →
                          </Text>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            </Container>
          )}

          {/* Experiments & Scores (side by side) */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Experiments */}
            <Container className="p-0">
              <SectionHeader
                title="A/B Experiments"
                linkTo="/ad-planning/experiments"
              />
              <div className="px-6 py-4">
                <div className="grid grid-cols-3 gap-3 mb-4">
                  <div className="p-3 bg-ui-bg-subtle rounded-lg text-center">
                    <Text size="xsmall" className="text-ui-fg-muted">
                      Running
                    </Text>
                    <Text
                      size="large"
                      weight="plus"
                      className="mt-1 text-ui-fg-positive"
                    >
                      {activeExperiments}
                    </Text>
                  </div>
                  <div className="p-3 bg-ui-bg-subtle rounded-lg text-center">
                    <Text size="xsmall" className="text-ui-fg-muted">
                      Completed
                    </Text>
                    <Text size="large" weight="plus" className="mt-1">
                      {completedExperiments}
                    </Text>
                  </div>
                  <div className="p-3 bg-ui-bg-subtle rounded-lg text-center">
                    <Text size="xsmall" className="text-ui-fg-muted">
                      Total
                    </Text>
                    <Text size="large" weight="plus" className="mt-1">
                      {experimentsData?.count || 0}
                    </Text>
                  </div>
                </div>

                {/* Recent experiments list */}
                {experimentsData?.experiments?.length > 0 && (
                  <div className="divide-y divide-ui-border-base rounded-lg border border-ui-border-base">
                    {experimentsData.experiments
                      .slice(0, 3)
                      .map((exp: any) => (
                        <Link
                          key={exp.id}
                          to={`/ad-planning/experiments/${exp.id}`}
                          className="block px-4 py-3 hover:bg-ui-bg-base-hover transition-colors first:rounded-t-lg last:rounded-b-lg"
                        >
                          <div className="flex items-center justify-between">
                            <div>
                              <Text
                                size="small"
                                leading="compact"
                                weight="plus"
                              >
                                {exp.name}
                              </Text>
                              <Text
                                size="xsmall"
                                leading="compact"
                                className="text-ui-fg-subtle capitalize"
                              >
                                {exp.primary_metric?.replace(/_/g, " ")}
                              </Text>
                            </div>
                            <Badge
                              color={
                                exp.status === "running"
                                  ? "green"
                                  : exp.status === "completed"
                                    ? "blue"
                                    : "grey"
                              }
                              size="xsmall"
                            >
                              {exp.status}
                            </Badge>
                          </div>
                        </Link>
                      ))}
                  </div>
                )}
              </div>
            </Container>

            {/* Customer Scores */}
            <Container className="p-0">
              <SectionHeader
                title="Customer Scores"
                linkTo="/ad-planning/scores"
              />
              <div className="px-6 py-4">
                <div className="grid grid-cols-2 gap-3 mb-4">
                  <div className="p-3 bg-ui-bg-subtle rounded-lg">
                    <Text size="xsmall" className="text-ui-fg-muted">
                      Total Scored
                    </Text>
                    <Text size="large" weight="plus" className="mt-1">
                      {totalScored.toLocaleString()}
                    </Text>
                  </div>
                  <div className="p-3 bg-ui-bg-subtle rounded-lg">
                    <Text size="xsmall" className="text-ui-fg-muted">
                      Avg CLV
                    </Text>
                    <Text size="large" weight="plus" className="mt-1">
                      ₹{(tierStats?.avg_clv || 0).toLocaleString()}
                    </Text>
                  </div>
                  <div className="p-3 bg-ui-bg-subtle rounded-lg">
                    <Text size="xsmall" className="text-ui-fg-muted">
                      Avg Engagement
                    </Text>
                    <Text size="large" weight="plus" className="mt-1">
                      {(tierStats?.avg_engagement || 0).toFixed(1)}
                    </Text>
                  </div>
                  <div className="p-3 bg-ui-bg-subtle rounded-lg">
                    <Text size="xsmall" className="text-ui-fg-muted">
                      High Churn Risk
                    </Text>
                    <Text
                      size="large"
                      weight="plus"
                      className="mt-1 text-ui-fg-error"
                    >
                      {(tierStats?.high_churn_count || 0).toLocaleString()}
                    </Text>
                  </div>
                </div>

                {/* Tier distribution */}
                {distribution.length > 0 && (
                  <div>
                    <div className="flex items-center gap-2 mb-2">
                      {distribution.map((tier: any) => {
                        const percent =
                          totalScored > 0
                            ? (tier.count / totalScored) * 100
                            : 0
                        const colors: Record<string, string> = {
                          platinum: "bg-ui-tag-green-bg",
                          gold: "bg-ui-tag-blue-bg",
                          silver: "bg-ui-tag-orange-bg",
                          bronze: "bg-ui-tag-neutral-bg",
                        }
                        return (
                          <div
                            key={tier.tier}
                            className={`h-6 ${colors[tier.tier.toLowerCase()] || "bg-ui-bg-subtle"} rounded`}
                            style={{ width: `${Math.max(percent, 5)}%` }}
                            title={`${tier.tier}: ${tier.count} (${percent.toFixed(1)}%)`}
                          />
                        )
                      })}
                    </div>
                    <div className="flex items-center justify-between">
                      {distribution.map((tier: any) => (
                        <div
                          key={tier.tier}
                          className="flex items-center gap-1"
                        >
                          <Badge
                            color={
                              tier.tier.toLowerCase() === "platinum"
                                ? "green"
                                : tier.tier.toLowerCase() === "gold"
                                  ? "blue"
                                  : tier.tier.toLowerCase() === "silver"
                                    ? "orange"
                                    : "grey"
                            }
                            size="xsmall"
                          >
                            {tier.tier}
                          </Badge>
                          <Text size="xsmall" className="text-ui-fg-subtle">
                            {tier.count.toLocaleString()}
                          </Text>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </Container>
          </div>

          {/* Segments & Attribution (side by side) */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Segments */}
            <Container className="p-0">
              <SectionHeader
                title="Customer Segments"
                linkTo="/ad-planning/segments"
              />
              <div className="px-6 py-4">
                <div className="grid grid-cols-2 gap-3">
                  <div className="p-3 bg-ui-bg-subtle rounded-lg">
                    <Text size="xsmall" className="text-ui-fg-muted">
                      Total Segments
                    </Text>
                    <Text size="large" weight="plus" className="mt-1">
                      {totalSegments}
                    </Text>
                  </div>
                  <div className="p-3 bg-ui-bg-subtle rounded-lg">
                    <Text size="xsmall" className="text-ui-fg-muted">
                      Active
                    </Text>
                    <Text
                      size="large"
                      weight="plus"
                      className="mt-1 text-ui-fg-positive"
                    >
                      {activeSegments}
                    </Text>
                  </div>
                  <div className="p-3 bg-ui-bg-subtle rounded-lg">
                    <Text size="xsmall" className="text-ui-fg-muted">
                      Dynamic
                    </Text>
                    <Text size="large" weight="plus" className="mt-1">
                      {segmentsData?.segments?.filter(
                        (s: any) => s.is_dynamic
                      ).length || 0}
                    </Text>
                  </div>
                  <div className="p-3 bg-ui-bg-subtle rounded-lg">
                    <Text size="xsmall" className="text-ui-fg-muted">
                      Total Members
                    </Text>
                    <Text size="large" weight="plus" className="mt-1">
                      {totalMembers.toLocaleString()}
                    </Text>
                  </div>
                </div>
              </div>
            </Container>

            {/* Attribution */}
            <Container className="p-0">
              <SectionHeader
                title="Campaign Attribution"
                linkTo="/ad-planning/attribution"
              />
              <div className="px-6 py-4">
                <div className="grid grid-cols-3 gap-3 mb-4">
                  <div className="p-3 bg-ui-bg-subtle rounded-lg text-center">
                    <Text size="xsmall" className="text-ui-fg-muted">
                      Attributions
                    </Text>
                    <Text size="large" weight="plus" className="mt-1">
                      {totalAttributions.toLocaleString()}
                    </Text>
                  </div>
                  <div className="p-3 bg-ui-bg-subtle rounded-lg text-center">
                    <Text size="xsmall" className="text-ui-fg-muted">
                      Conversions
                    </Text>
                    <Text
                      size="large"
                      weight="plus"
                      className="mt-1 text-ui-fg-positive"
                    >
                      {(attrSummary?.converted || 0).toLocaleString()}
                    </Text>
                  </div>
                  <div className="p-3 bg-ui-bg-subtle rounded-lg text-center">
                    <Text size="xsmall" className="text-ui-fg-muted">
                      Conv. Rate
                    </Text>
                    <Text size="large" weight="plus" className="mt-1">
                      {attrConversionRate.toFixed(1)}%
                    </Text>
                  </div>
                </div>

                {/* Source breakdown */}
                {attrSummary?.by_source &&
                  Object.keys(attrSummary.by_source).length > 0 && (
                    <div className="grid grid-cols-2 gap-2">
                      {Object.entries(attrSummary.by_source)
                        .slice(0, 6)
                        .map(([source, data]: [string, any]) => (
                          <div
                            key={source}
                            className="flex items-center justify-between p-2 bg-ui-bg-subtle rounded"
                          >
                            <Badge
                              color={
                                source.toLowerCase().includes("google")
                                  ? "blue"
                                  : source.toLowerCase().includes("facebook") ||
                                      source
                                        .toLowerCase()
                                        .includes("instagram") ||
                                      source.toLowerCase().includes("meta")
                                    ? "purple"
                                    : source.toLowerCase().includes("email")
                                      ? "green"
                                      : "grey"
                              }
                              size="xsmall"
                            >
                              {source}
                            </Badge>
                            <Text size="xsmall" className="text-ui-fg-subtle">
                              {data.count?.toLocaleString() || 0}
                            </Text>
                          </div>
                        ))}
                    </div>
                  )}
              </div>
            </Container>
          </div>
        </div>
      </RouteFocusModal.Body>
    </RouteFocusModal>
  )
}

export const handle = {
  breadcrumb: () => "Metrics",
}

export default MetricsModal
