import { defineRouteConfig } from "@medusajs/admin-sdk"
import { BuildingStorefront } from "@medusajs/icons"
import {
  Alert,
  Button,
  Container,
  DataTable,
  DataTableFilteringState,
  DataTablePaginationState,
  Heading,
  Label,
  Skeleton,
  StatusBadge,
  Text,
  Toaster,
  toast,
  createDataTableFilterHelper,
  useDataTable,
} from "@medusajs/ui"
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import { useState } from "react"
import { useNavigate } from "react-router-dom"
import { faireApi } from "../../../lib/api"
import { useFaireSyncColumns, FaireSyncRecord } from "./hooks/use-faire-sync-columns"

const PAGE_SIZE = 10
const STATUS_KEY = ["faire", "status"]

type Status = {
  connected: boolean
  account: any | null
  settings: any
  readiness: {
    connected: boolean
    brand: boolean
    wholesale_pricing: boolean
    shipping_policy: boolean
    ready_to_publish: boolean
  }
}

const FaireSettingsPage = () => {
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const [pagination, setPagination] = useState<DataTablePaginationState>({
    pageIndex: 0,
    pageSize: PAGE_SIZE,
  })
  const [filtering, setFiltering] = useState<DataTableFilteringState>({})

  // ── Queries ───────────────────────────────────────────────────────────────
  const statusQuery = useQuery({
    queryKey: STATUS_KEY,
    queryFn: () => faireApi.status() as Promise<Status>,
  })
  const status = statusQuery.data
  const connected = !!status?.connected

  const syncsQuery = useQuery({
    queryKey: ["faire", "syncs", pagination, filtering],
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const statusFilter = (filtering.status as any)?.[0] as string | undefined
      const res = await faireApi.listSyncs({
        take: pagination.pageSize,
        skip: pagination.pageIndex * pagination.pageSize,
        status: statusFilter,
      })
      return { syncs: (res as any).syncs || [], count: (res as any).count || 0 }
    },
  })

  // ── Mutations ───────────────────────────────────────────────────────────────
  const connectMutation = useMutation({
    mutationFn: () => faireApi.authorize(),
    onSuccess: (res: any) => {
      window.open(res.authorization_url, "_blank")
      toast.info("Faire authorization opened", {
        description: "Complete the authorization in the new tab.",
      })
    },
    onError: (err: any) =>
      toast.error("Failed to start Faire authorization", {
        description: err.message,
      }),
  })

  const disconnectMutation = useMutation({
    mutationFn: () => faireApi.disconnect(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: STATUS_KEY })
      toast.success("Disconnected from Faire")
    },
    onError: (err: any) =>
      toast.error("Failed to disconnect", { description: err.message }),
  })

  // ── DataTable ───────────────────────────────────────────────────────────────
  const columns = useFaireSyncColumns()
  const filterHelper = createDataTableFilterHelper<FaireSyncRecord>()
  const filters = [
    filterHelper.accessor("status", {
      type: "select",
      label: "Status",
      options: [
        { label: "Success", value: "success" },
        { label: "Draft", value: "draft" },
        { label: "Failed", value: "failed" },
        { label: "Pending", value: "pending" },
        { label: "Syncing", value: "syncing" },
      ],
    }),
  ]

  const table = useDataTable({
    data: syncsQuery.data?.syncs ?? [],
    columns,
    rowCount: syncsQuery.data?.count ?? 0,
    getRowId: (row: FaireSyncRecord) => row.id,
    onRowClick: (_: any, row: FaireSyncRecord) => {
      navigate(`/settings/faire/${row.id}`)
    },
    isLoading: syncsQuery.isLoading,
    filters,
    pagination: {
      state: pagination,
      onPaginationChange: setPagination,
    },
    filtering: {
      state: filtering,
      onFilteringChange: setFiltering,
    },
  })

  if (statusQuery.isLoading) {
    return (
      <div className="flex flex-col gap-4">
        <Container className="divide-y p-0">
          <div className="flex items-center justify-between px-6 py-4">
            <Skeleton className="h-6 w-32" />
            <Skeleton className="h-7 w-28" />
          </div>
          <div className="grid grid-cols-4 gap-4 px-6 py-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        </Container>
        <Container className="p-0">
          <div className="px-6 py-4">
            <Skeleton className="h-5 w-32" />
          </div>
          <div className="flex flex-col gap-3 px-6 pb-6">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        </Container>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {statusQuery.isError && (
        <Alert variant="error">
          {(statusQuery.error as any)?.message || "Failed to load Faire status"}
        </Alert>
      )}

      {/* Connection */}
      <Container className="divide-y p-0">
        <div className="flex items-center justify-between px-6 py-4">
          <div className="flex flex-col gap-1">
            <Heading level="h1">Faire Sync</Heading>
            <Text className="text-ui-fg-subtle">
              Connect your Faire brand and sync Medusa products, inventory and
              orders bidirectionally.
            </Text>
          </div>
          {connected ? (
            <div className="flex items-center gap-3">
              <StatusBadge color="green">Connected</StatusBadge>
              <Button
                size="small"
                variant="secondary"
                onClick={() => navigate("/settings/faire/settings")}
              >
                Sync settings
              </Button>
              <Button
                size="small"
                variant="danger"
                onClick={() => disconnectMutation.mutate()}
                isLoading={disconnectMutation.isPending}
              >
                Disconnect
              </Button>
            </div>
          ) : (
            <Button
              size="small"
              onClick={() => connectMutation.mutate()}
              isLoading={connectMutation.isPending}
            >
              Connect Faire
            </Button>
          )}
        </div>
        {connected && status?.account && (
          <div className="px-6 py-4 grid grid-cols-4 gap-4">
            <InfoField label="Brand" value={status.account.brand_name} />
            <InfoField label="Brand ID" value={status.account.brand_id} />
            <InfoField label="Currency" value={status.account.currency || "—"} />
            <InfoField
              label="Token expires"
              value={
                status.account.token_expires_at
                  ? new Date(status.account.token_expires_at).toLocaleString()
                  : "Does not expire"
              }
            />
          </div>
        )}
      </Container>

      {/* Bulk operations */}
      <BulkOperations connected={connected} />

      {/* Recent syncs */}
      <Container className="divide-y p-0">
        <DataTable instance={table}>
          <DataTable.Toolbar className="flex flex-col md:flex-row justify-between gap-y-4 px-6 py-4">
            <div>
              <Heading>Recent syncs</Heading>
              <Text className="text-ui-fg-subtle" size="small">
                Latest product sync attempts. Click a row for details.
              </Text>
            </div>
            <div className="flex items-center gap-x-2">
              <DataTable.FilterMenu tooltip="Filter syncs" />
              <Button
                size="small"
                variant="secondary"
                onClick={() => syncsQuery.refetch()}
                isLoading={syncsQuery.isFetching}
              >
                Refresh
              </Button>
            </div>
          </DataTable.Toolbar>
          <DataTable.Table />
          <DataTable.Pagination />
        </DataTable>
      </Container>

      <Toaster />
    </div>
  )
}

const InfoField = ({ label, value }: { label: string; value: string }) => (
  <div className="flex flex-col gap-1">
    <Label>{label}</Label>
    <Text>{value}</Text>
  </div>
)

/**
 * Bulk operations card: push many products to Faire, and pull Faire orders into
 * Medusa. Both run as long-running background workflows; progress is polled.
 */
const BulkOperations = ({ connected }: { connected: boolean }) => {
  const [productIds, setProductIds] = useState("")
  const [pushBatch, setPushBatch] = useState<string | null>(null)
  const [pullBatch, setPullBatch] = useState<string | null>(null)

  const pushMutation = useMutation({
    mutationFn: (ids: string[]) => faireApi.syncBulk(ids),
    onSuccess: (res: any) => {
      setPushBatch(res.batch_id)
      toast.success("Bulk product sync started", {
        description: "Running in the background. Polling progress…",
      })
    },
    onError: (err: any) =>
      toast.error("Failed to start bulk sync", { description: err.message }),
  })

  const pullMutation = useMutation({
    mutationFn: () => faireApi.ingestOrders(),
    onSuccess: (res: any) => {
      setPullBatch(res.batch_id)
      toast.success("Faire order pull started", {
        description: "Running in the background. Polling progress…",
      })
    },
    onError: (err: any) =>
      toast.error("Failed to start order pull", { description: err.message }),
  })

  // Poll both batches until finished.
  const pushStatus = useQuery({
    queryKey: ["faire", "bulk", pushBatch],
    enabled: !!pushBatch,
    refetchInterval: (q) =>
      (q.state.data as any)?.progress?.finished ? false : 3000,
    queryFn: () => faireApi.bulkStatus(pushBatch!),
  })
  const pullStatus = useQuery({
    queryKey: ["faire", "ingest", pullBatch],
    enabled: !!pullBatch,
    refetchInterval: (q) =>
      (q.state.data as any)?.progress?.finished ? false : 3000,
    queryFn: () => faireApi.ingestStatus(pullBatch!),
  })

  const pushProgress = (pushStatus.data as any)?.progress
  const pullProgress = (pullStatus.data as any)?.progress

  const handlePush = () => {
    const ids = productIds
      .split(/[\s,]+/)
      .map((s) => s.trim())
      .filter(Boolean)
    if (!ids.length) {
      toast.error("Enter at least one product id")
      return
    }
    pushMutation.mutate(ids)
  }

  return (
    <Container className="divide-y p-0">
      <div className="px-6 py-4">
        <Heading>Bulk operations</Heading>
        <Text className="text-ui-fg-subtle" size="small">
          Push many products to Faire, or pull wholesale orders from Faire into
          Medusa. Both run as long-running background workflows.
        </Text>
      </div>
      <div className="px-6 py-4 flex flex-col gap-6">
        {/* Push products */}
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <Label>Push products to Faire</Label>
            <Text className="text-ui-fg-subtle" size="small">
              Comma- or line-separated Medusa product IDs.
            </Text>
          </div>
          <textarea
            className="border-ui-border-base rounded-lg border px-3 py-2 text-sm min-h-[72px]"
            placeholder="prod_01..., prod_02..."
            value={productIds}
            onChange={(e) => setProductIds(e.target.value)}
            disabled={!connected || pushMutation.isPending}
          />
          <div className="flex items-center gap-3">
            <Button
              size="small"
              onClick={handlePush}
              disabled={!connected || pushMutation.isPending}
              isLoading={pushMutation.isPending}
            >
              Start bulk push
            </Button>
            {pushBatch && pushProgress && (
              <BulkProgress
                label="Push"
                progress={pushProgress}
                status={(pushStatus.data as any)?.batch?.status}
              />
            )}
          </div>
        </div>

        {/* Pull orders */}
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <Label>Pull Faire orders into Medusa</Label>
            <Text className="text-ui-fg-subtle" size="small">
              Ingests all available Faire orders as Medusa orders (idempotent).
            </Text>
          </div>
          <div className="flex items-center gap-3">
            <Button
              size="small"
              variant="secondary"
              onClick={() => pullMutation.mutate()}
              disabled={!connected || pullMutation.isPending}
              isLoading={pullMutation.isPending}
            >
              Start order pull
            </Button>
            {pullBatch && pullProgress && (
              <BulkProgress
                label="Pull"
                progress={pullProgress}
                status={(pullStatus.data as any)?.batch?.status}
              />
            )}
          </div>
        </div>
      </div>
    </Container>
  )
}

const BulkProgress = ({
  label,
  progress,
  status,
}: {
  label: string
  progress: { total: number; done: number; pct: number; finished: boolean }
  status?: string
}) => (
  <div className="flex items-center gap-3">
    <StatusBadge color={progress.finished ? (status === "failed" ? "red" : "green") : "orange"}>
      {label}: {progress.done}/{progress.total || "?"} ({progress.pct}%)
    </StatusBadge>
    {progress.finished && (
      <Text className="text-ui-fg-subtle" size="small">
        {status === "failed" ? "Completed with errors" : "Done"}
      </Text>
    )}
  </div>
)

export const config = defineRouteConfig({
  label: "Faire",
  icon: BuildingStorefront,
})

export const handle = {
  breadcrumb: () => "Faire Sync",
}

export default FaireSettingsPage
