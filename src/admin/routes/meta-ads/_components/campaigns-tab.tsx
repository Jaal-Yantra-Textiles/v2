import {
  Button,
  Container,
  DataTable,
  DataTablePaginationState,
  Heading,
  Text,
  useDataTable,
  StatusBadge,
  createDataTableFilterHelper,
  DataTableFilteringState,
  toast,
  Select,
  Badge,
} from "@medusajs/ui"
import {
  useAdCampaigns,
  useAdAccounts,
  useSyncAdAccounts,
  useSyncCampaigns,
  useSyncInsights,
  useCampaignTotals,
  AdCampaign,
} from "../../../../hooks/api/meta-ads"
import { useSocialPlatforms } from "../../../../hooks/api/social-platforms"
import { useDefaultStore } from "../../../../hooks/api/stores"
import { useNavigate, useSearchParams } from "react-router-dom"
import { ChartBar, ArrowPath } from "@medusajs/icons"
import { useCallback, useMemo, useState } from "react"
import debounce from "lodash/debounce"
import { createColumnHelper } from "@tanstack/react-table"

const PAGE_SIZE = 20

const formatCurrency = (value: number | null | undefined, currency = "USD", locale = "en-US"): string => {
  if (value === null || value === undefined) return "—"
  try {
    return new Intl.NumberFormat(locale, { style: "currency", currency, minimumFractionDigits: 2 }).format(value)
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

const getStatusBadgeColor = (status: string): "green" | "orange" | "red" | "grey" => {
  switch (status) {
    case "ACTIVE": return "green"
    case "PAUSED": return "orange"
    case "DELETED": return "red"
    case "ARCHIVED": return "grey"
    default: return "grey"
  }
}

const columnHelper = createColumnHelper<AdCampaign>()

export const CampaignsTab = () => {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const [selectedPlatformId, setSelectedPlatformId] = useState<string>("")
  const [selectedAccountId, setSelectedAccountId] = useState<string>("")
  const [syncingInsights, setSyncingInsights] = useState(false)

  const pageFromUrl = parseInt(searchParams.get("page") || "1", 10)
  const limitFromUrl = parseInt(searchParams.get("limit") || String(PAGE_SIZE), 10)

  const pagination: DataTablePaginationState = {
    pageIndex: Math.max(0, pageFromUrl - 1),
    pageSize: limitFromUrl,
  }

  const statusFilter = searchParams.get("status") || undefined
  const accountFilter = searchParams.get("ad_account_id") || undefined

  const filtering: DataTableFilteringState = {}
  if (statusFilter) filtering.status = statusFilter
  if (accountFilter) filtering.ad_account_id = accountFilter

  const offset = pagination.pageIndex * pagination.pageSize

  const { data, isLoading, isError, error } = useAdCampaigns({
    limit: pagination.pageSize,
    offset,
    status: statusFilter,
    ad_account_id: accountFilter,
  })

  const { socialPlatforms } = useSocialPlatforms({ limit: 100 })
  const { data: accountsData, refetch: refetchAccounts } = useAdAccounts()
  const syncAdAccountsMutation = useSyncAdAccounts()
  const syncCampaignsMutation = useSyncCampaigns()
  const syncInsightsMutation = useSyncInsights()
  const { store } = useDefaultStore()
  const { data: totalsData } = useCampaignTotals()

  const defaultCurrency = useMemo(() => {
    const defaultCurrencyObj = store?.supported_currencies?.find(c => c.is_default)
    return {
      code: defaultCurrencyObj?.currency_code?.toUpperCase() || "USD",
      symbol: defaultCurrencyObj?.currency_code === "inr" ? "₹" : "$",
    }
  }, [store])

  const metaPlatforms = useMemo(() => {
    return socialPlatforms?.filter(p =>
      p.name.toLowerCase().includes('facebook') ||
      p.name.toLowerCase().includes('instagram') ||
      p.name.toLowerCase().includes('meta')
    ) || []
  }, [socialPlatforms])

  const adAccounts = accountsData?.accounts || []

  const handlePaginationChange = useCallback((newPagination: DataTablePaginationState) => {
    const params = new URLSearchParams(searchParams)
    if (newPagination.pageIndex > 0) {
      params.set("page", String(newPagination.pageIndex + 1))
    } else {
      params.delete("page")
    }
    setSearchParams(params, { replace: true })
  }, [searchParams, setSearchParams])

  const handleFilterChange = useCallback(
    debounce((newFilters: DataTableFilteringState) => {
      const params = new URLSearchParams()
      if (newFilters.status) params.set("status", newFilters.status as string)
      if (newFilters.ad_account_id) params.set("ad_account_id", newFilters.ad_account_id as string)
      setSearchParams(params, { replace: true })
    }, 300),
    [setSearchParams]
  )

  const handleSyncAdAccounts = async () => {
    if (!selectedPlatformId) {
      toast.error("Please select a platform first")
      return
    }
    try {
      const result = await syncAdAccountsMutation.mutateAsync(selectedPlatformId)
      toast.success(`Synced ${result.results.created} new, ${result.results.updated} updated ad accounts`)
      refetchAccounts()
    } catch (e: any) {
      if (e.message?.includes("re-authenticate") || e.message?.includes("Page token")) {
        toast.error("Please reconnect your Facebook account with Ads permissions enabled")
      } else {
        toast.error(e.message || "Failed to sync ad accounts")
      }
    }
  }

  const handleSyncCampaigns = async () => {
    if (!selectedAccountId) {
      toast.error("Please select an ad account")
      return
    }
    try {
      const result = await syncCampaignsMutation.mutateAsync({
        ad_account_id: selectedAccountId,
        include_insights: true,
      })
      toast.success(`Synced ${result.results.created} new, ${result.results.updated} updated campaigns`)
    } catch (e: any) {
      toast.error(e.message || "Failed to sync campaigns")
    }
  }

  const handleSyncInsights = async () => {
    if (!selectedPlatformId || !selectedAccountId) {
      toast.error("Please select a platform and ad account")
      return
    }
    setSyncingInsights(true)
    try {
      const result = await syncInsightsMutation.mutateAsync({
        platform_id: selectedPlatformId,
        ad_account_id: selectedAccountId,
        level: "campaign",
        date_preset: "last_30d",
      })
      const { synced, updated, errors, error_messages } = result.results
      if (errors > 0 && synced === 0 && updated === 0) {
        toast.error(error_messages?.[0] || "Failed to sync insights")
      } else if (errors > 0) {
        toast.warning(`Synced ${synced + updated} insights, ${errors} failed`)
      } else {
        toast.success(`Synced ${synced} new, ${updated} updated insights`)
      }
    } catch (e: any) {
      toast.error(e.message || "Failed to sync insights")
    } finally {
      setSyncingInsights(false)
    }
  }

  const campaigns = data?.campaigns || []
  const count = data?.total || 0

  const columns = useMemo(() => [
    columnHelper.accessor("name", {
      header: "Campaign",
      cell: ({ getValue, row }) => {
        const name = getValue()
        const objective = row.original.objective
        return (
          <div>
            <span className="font-medium">{name}</span>
            {objective && objective !== "OTHER" && (
              <Badge size="2xsmall" color="grey" className="ml-2">
                {objective.replace("OUTCOME_", "").replace(/_/g, " ")}
              </Badge>
            )}
          </div>
        )
      },
    }),
    columnHelper.accessor("status", {
      header: "Status",
      cell: ({ getValue }) => <StatusBadge color={getStatusBadgeColor(getValue())}>{getValue()}</StatusBadge>,
    }),
    columnHelper.accessor("spend", {
      header: "Spend",
      cell: ({ getValue }) => formatCurrency(getValue() as number, defaultCurrency.code),
    }),
    columnHelper.accessor("impressions", {
      header: "Impressions",
      cell: ({ getValue }) => formatNumber(getValue() as number),
    }),
    columnHelper.accessor("clicks", {
      header: "Clicks",
      cell: ({ getValue }) => formatNumber(getValue() as number),
    }),
    columnHelper.accessor("ctr", {
      header: "CTR",
      cell: ({ getValue }) => formatPercent(getValue() as number),
    }),
    columnHelper.accessor("leads", {
      header: "Leads",
      cell: ({ getValue }) => formatNumber(getValue() as number),
    }),
    columnHelper.accessor("cost_per_lead", {
      header: "CPL",
      cell: ({ getValue }) => formatCurrency(getValue() as number, defaultCurrency.code),
    }),
  ], [defaultCurrency.code])

  const filterHelper = createDataTableFilterHelper<AdCampaign>()

  const filters = [
    filterHelper.accessor("status", {
      type: "select",
      label: "Status",
      options: [
        { label: "Active", value: "ACTIVE" },
        { label: "Paused", value: "PAUSED" },
        { label: "Deleted", value: "DELETED" },
        { label: "Archived", value: "ARCHIVED" },
      ],
    }),
  ]

  const table = useDataTable({
    data: campaigns,
    columns,
    rowCount: count,
    filters,
    filtering: { state: filtering, onFilteringChange: handleFilterChange },
    getRowId: (row) => row.id,
    onRowClick: (_, row) => navigate(`/meta-ads/campaigns/${row.id}`),
    isLoading,
    pagination: { state: pagination, onPaginationChange: handlePaginationChange },
  })

  if (isError) throw error

  const totals = totalsData || { spend: 0, impressions: 0, clicks: 0, leads: 0, avgCTR: 0, avgCPL: 0 }

  return (
    <Container className="divide-y p-0">
      {/* Sync controls — above the table, outside DataTable */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 px-6 py-4">
        <Text size="small" className="text-ui-fg-subtle whitespace-nowrap">Sync:</Text>
        <Select
          size="small"
          value={selectedPlatformId}
          onValueChange={(value) => { setSelectedPlatformId(value); setSelectedAccountId("") }}
        >
          <Select.Trigger className="w-[130px]">
            <Select.Value placeholder="Platform" />
          </Select.Trigger>
          <Select.Content>
            {metaPlatforms.map((platform) => (
              <Select.Item key={platform.id} value={platform.id}>{platform.name}</Select.Item>
            ))}
          </Select.Content>
        </Select>

        {selectedPlatformId && (
          <>
            <Select size="small" value={selectedAccountId} onValueChange={setSelectedAccountId}>
              <Select.Trigger className="w-[140px]">
                <Select.Value placeholder="Ad Account" />
              </Select.Trigger>
              <Select.Content>
                {adAccounts.length === 0 ? (
                  <div className="px-3 py-2 text-ui-fg-subtle text-sm">Click sync first</div>
                ) : (
                  adAccounts.map((account) => (
                    <Select.Item key={account.id} value={account.meta_account_id}>{account.name}</Select.Item>
                  ))
                )}
              </Select.Content>
            </Select>

            <Button size="small" variant="secondary" onClick={handleSyncAdAccounts} isLoading={syncAdAccountsMutation.isPending} title="Sync ad accounts">
              <ArrowPath />
            </Button>
          </>
        )}

        {selectedAccountId && (
          <>
            <Button size="small" variant="secondary" onClick={handleSyncCampaigns} isLoading={syncCampaignsMutation.isPending}>
              {!syncCampaignsMutation.isPending && <ArrowPath className="mr-1" />}
              Campaigns
            </Button>
            <Button size="small" variant="secondary" onClick={handleSyncInsights} isLoading={syncingInsights}>
              {!syncingInsights && <ChartBar className="mr-1" />}
              Insights
            </Button>
          </>
        )}
      </div>

      {/* Summary cards */}
      {campaigns.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 px-6 py-4">
          <div className="bg-ui-bg-base border border-ui-border-base rounded-lg p-4">
            <Text size="small" className="text-ui-fg-subtle">Total Spend</Text>
            <Text className="text-lg font-semibold">{formatCurrency(totals.spend, defaultCurrency.code)}</Text>
          </div>
          <div className="bg-ui-bg-base border border-ui-border-base rounded-lg p-4">
            <Text size="small" className="text-ui-fg-subtle">Impressions</Text>
            <Text className="text-lg font-semibold">{formatNumber(totals.impressions)}</Text>
          </div>
          <div className="bg-ui-bg-base border border-ui-border-base rounded-lg p-4">
            <Text size="small" className="text-ui-fg-subtle">Clicks</Text>
            <Text className="text-lg font-semibold">{formatNumber(totals.clicks)}</Text>
          </div>
          <div className="bg-ui-bg-base border border-ui-border-base rounded-lg p-4">
            <Text size="small" className="text-ui-fg-subtle">Avg CTR</Text>
            <Text className="text-lg font-semibold">{formatPercent(totals.avgCTR)}</Text>
          </div>
          <div className="bg-ui-bg-base border border-ui-border-base rounded-lg p-4">
            <Text size="small" className="text-ui-fg-subtle">Total Leads</Text>
            <Text className="text-lg font-semibold">{formatNumber(totals.leads)}</Text>
          </div>
          <div className="bg-ui-bg-base border border-ui-border-base rounded-lg p-4">
            <Text size="small" className="text-ui-fg-subtle">Avg CPL</Text>
            <Text className="text-lg font-semibold">{formatCurrency(totals.avgCPL, defaultCurrency.code)}</Text>
          </div>
        </div>
      )}

      <DataTable instance={table}>
        <DataTable.Toolbar className="flex flex-col md:flex-row justify-between gap-y-4 w-full px-6 py-4">
          <div>
            <Heading>Ad Campaigns</Heading>
            <Text className="text-ui-fg-subtle" size="small">View and analyze your Meta ad campaigns</Text>
          </div>
          <div className="flex items-center gap-x-2">
            <DataTable.FilterMenu tooltip="Filter campaigns" />
          </div>
        </DataTable.Toolbar>
        <DataTable.Table />
        <DataTable.Pagination />
      </DataTable>
    </Container>
  )
}
