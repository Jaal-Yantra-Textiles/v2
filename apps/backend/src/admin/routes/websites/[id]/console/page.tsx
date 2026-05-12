import {
  Button,
  Container,
  DataTable,
  type DataTablePaginationState,
  Heading,
  Input,
  Select,
  StatusBadge,
  Text,
  toast,
  useDataTable,
} from "@medusajs/ui"
import { ArrowPath, ArrowLeft } from "@medusajs/icons"
import { createColumnHelper } from "@tanstack/react-table"
import { useMemo, useState } from "react"
import { useNavigate, useParams, useSearchParams } from "react-router-dom"
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import {
  type ConsoleDimension,
  type ConsoleInsightRow,
  useWebsiteConsoleInsights,
  useWebsiteConsoleStatus,
  useWebsiteConsoleSync,
} from "../../../../hooks/api/search-console"

const today = () => new Date().toISOString().slice(0, 10)
const daysAgo = (n: number) => {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d.toISOString().slice(0, 10)
}

export default function WebsiteConsolePage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()

  const websiteId = id || ""
  const from = searchParams.get("from") || daysAgo(28)
  const to = searchParams.get("to") || today()

  const { data: status, isLoading: statusLoading } =
    useWebsiteConsoleStatus(websiteId)

  const sync = useWebsiteConsoleSync(websiteId)

  // Trend chart pulls "date" dimension; the other two sections pull
  // "query" and "page". Three queries fired in parallel keep each
  // tab snappy and cacheable independently.
  const trend = useWebsiteConsoleInsights(websiteId, {
    dimension: "date",
    from,
    to,
  })
  const queries = useWebsiteConsoleInsights(websiteId, {
    dimension: "query",
    from,
    to,
    limit: 100,
  })
  const pages = useWebsiteConsoleInsights(websiteId, {
    dimension: "page",
    from,
    to,
    limit: 100,
  })

  const updateParam = (key: string, value: string | undefined) => {
    const next = new URLSearchParams(searchParams)
    if (value) next.set(key, value)
    else next.delete(key)
    setSearchParams(next, { replace: true })
  }

  const onSync = async () => {
    try {
      const res = await sync.mutateAsync({})
      const r = res.result
      if (r.errors && r.errors.length) {
        toast.warning("Synced with errors", {
          description: `${r.insights_rows_synced} rows · ${r.errors[0].message}`,
        })
      } else {
        toast.success("Sync complete", {
          description: `${r.sites_synced} site · ${r.insights_rows_synced} rows`,
        })
      }
    } catch (e: any) {
      toast.error("Sync failed", {
        description:
          e?.response?.data?.message || e?.message || "Unknown error",
      })
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 px-6 py-4">
        <Button
          variant="transparent"
          size="small"
          onClick={() => navigate(`/websites/${websiteId}`)}
          className="px-2"
        >
          <ArrowLeft />
        </Button>
        <div className="mr-auto">
          <Heading>Search Console</Heading>
          <Text className="text-ui-fg-subtle" size="small">
            {statusLoading
              ? "…"
              : status?.website
                ? `Google Search Analytics for ${status.website.domain}`
                : "Website not found"}
          </Text>
        </div>
        {status?.bound && (
          <Button
            size="small"
            variant="secondary"
            onClick={onSync}
            isLoading={sync.isPending}
            disabled={sync.isPending}
          >
            {!sync.isPending && <ArrowPath className="mr-1" />}
            Sync now
          </Button>
        )}
      </div>

      {/* Bound-state header */}
      {!statusLoading && status && !status.bound && (
        <Container className="m-6 p-6">
          <Heading level="h3">No Search Console property bound</Heading>
          <Text className="text-ui-fg-subtle" size="small">
            {status.website
              ? `${status.website.domain} doesn't have a verified Search Console property bound on any of your Google connections.`
              : ""}{" "}
            Connect Google in Settings → External Platforms and bind one of the
            following resource URLs as a Search Console binding:
          </Text>
          <ul className="mt-3 text-xs text-ui-fg-subtle font-mono space-y-1">
            {status.candidates.map((c) => (
              <li key={c}>• {c}</li>
            ))}
          </ul>
        </Container>
      )}

      {status?.bound && (
        <>
          <div className="flex flex-wrap items-center gap-3 px-6 pb-3">
            <Text size="small" className="text-ui-fg-subtle whitespace-nowrap">
              From:
            </Text>
            <Input
              type="date"
              size="small"
              value={from}
              onChange={(e) => updateParam("from", e.target.value)}
              className="w-[160px]"
            />
            <Text size="small" className="text-ui-fg-subtle whitespace-nowrap">
              To:
            </Text>
            <Input
              type="date"
              size="small"
              value={to}
              onChange={(e) => updateParam("to", e.target.value)}
              className="w-[160px]"
            />
            <div className="ml-auto flex items-center gap-2">
              <Text size="small" className="text-ui-fg-subtle whitespace-nowrap">
                Property:
              </Text>
              <Text size="small" className="font-mono">
                {status.binding?.resource_id}
              </Text>
              {status.site?.sync_status && (
                <StatusBadge color={statusColor(status.site.sync_status)}>
                  {status.site.sync_status}
                </StatusBadge>
              )}
            </div>
          </div>

          <Container className="m-6 p-0 divide-y">
            <div className="px-6 py-6">
              <Heading level="h3" className="mb-1">
                Performance trend
              </Heading>
              <Text size="small" className="text-ui-fg-subtle mb-4">
                Daily clicks and impressions (left axis), average position
                (right axis).
              </Text>
              {!status.site ? (
                <Text size="small" className="text-ui-fg-subtle">
                  Site bound but never synced yet. Hit{" "}
                  <span className="font-medium">Sync now</span> above to pull
                  data.
                </Text>
              ) : (trend.data?.rows.length || 0) === 0 ? (
                <Text size="small" className="text-ui-fg-subtle">
                  No rows in this window.
                </Text>
              ) : (
                <ResponsiveContainer width="100%" height={280}>
                  <LineChart data={trend.data?.rows || []}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                    <YAxis yAxisId="left" tick={{ fontSize: 11 }} />
                    <YAxis
                      yAxisId="right"
                      orientation="right"
                      tick={{ fontSize: 11 }}
                      reversed
                    />
                    <Tooltip />
                    <Legend />
                    <Line
                      yAxisId="left"
                      type="monotone"
                      dataKey="clicks"
                      stroke="#82ca9d"
                      dot={false}
                    />
                    <Line
                      yAxisId="left"
                      type="monotone"
                      dataKey="impressions"
                      stroke="#8884d8"
                      dot={false}
                    />
                    <Line
                      yAxisId="right"
                      type="monotone"
                      dataKey="position"
                      stroke="#ff7300"
                      dot={false}
                      name="position (lower = better)"
                    />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </div>
          </Container>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 m-6 mt-0">
            <DimensionTable
              title="Top queries"
              dimension="query"
              rows={queries.data?.rows || []}
              isLoading={queries.isLoading}
            />
            <DimensionTable
              title="Top pages"
              dimension="page"
              rows={pages.data?.rows || []}
              isLoading={pages.isLoading}
            />
          </div>
        </>
      )}
    </div>
  )
}

function statusColor(
  status: string
): "green" | "orange" | "red" | "grey" {
  if (status === "synced") return "green"
  if (status === "syncing" || status === "pending") return "orange"
  if (status === "error") return "red"
  return "grey"
}

const columnHelper = createColumnHelper<ConsoleInsightRow>()

const DimensionTable = ({
  title,
  dimension,
  rows,
  isLoading,
}: {
  title: string
  dimension: ConsoleDimension
  rows: ConsoleInsightRow[]
  isLoading: boolean
}) => {
  const [pageIndex, setPageIndex] = useState(0)
  const pageSize = 20

  const columns = useMemo(
    () => [
      columnHelper.accessor((r) => r[dimension] || "—", {
        id: dimension,
        header: dimension.charAt(0).toUpperCase() + dimension.slice(1),
        cell: (info) => (
          <span className="truncate block max-w-[420px]" title={String(info.getValue())}>
            {String(info.getValue())}
          </span>
        ),
      }),
      columnHelper.accessor("clicks", {
        header: "Clicks",
        cell: (info) => formatInt(info.getValue()),
      }),
      columnHelper.accessor("impressions", {
        header: "Impressions",
        cell: (info) => formatInt(info.getValue()),
      }),
      columnHelper.accessor("ctr", {
        header: "CTR",
        cell: (info) =>
          info.getValue() === null || info.getValue() === undefined
            ? "—"
            : `${((info.getValue() as number) * 100).toFixed(2)}%`,
      }),
      columnHelper.accessor("position", {
        header: "Position",
        cell: (info) =>
          info.getValue() === null || info.getValue() === undefined
            ? "—"
            : (info.getValue() as number).toFixed(1),
      }),
    ],
    [dimension]
  )

  const pagination: DataTablePaginationState = {
    pageIndex,
    pageSize,
  }
  const pageStart = pageIndex * pageSize
  const pageRows = rows.slice(pageStart, pageStart + pageSize)

  const table = useDataTable({
    data: pageRows,
    columns,
    rowCount: rows.length,
    getRowId: (row) => String((row as any)[dimension] || Math.random()),
    isLoading,
    pagination: {
      state: pagination,
      onPaginationChange: (next) => setPageIndex(next.pageIndex),
    },
  })

  return (
    <Container className="divide-y p-0">
      <DataTable instance={table}>
        <DataTable.Toolbar className="flex flex-col md:flex-row justify-between gap-y-4 w-full px-6 py-4">
          <div>
            <Heading>{title}</Heading>
            <Text className="text-ui-fg-subtle" size="small">
              {rows.length} {dimension === "query" ? "queries" : "pages"} ranked
              by clicks in the selected window.
            </Text>
          </div>
        </DataTable.Toolbar>
        <DataTable.Table />
        <DataTable.Pagination />
      </DataTable>
    </Container>
  )
}

function formatInt(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—"
  return new Intl.NumberFormat("en-US").format(n)
}
