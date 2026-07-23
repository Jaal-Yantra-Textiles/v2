import { defineRouteConfig } from "@medusajs/admin-sdk"
import { BuildingStorefront, ChevronDownMini } from "@medusajs/icons"
import {
  Alert,
  Button,
  Container,
  DataTable,
  DataTableFilteringState,
  DataTablePaginationState,
  Drawer,
  DropdownMenu,
  Heading,
  Input,
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
import { Outlet, useNavigate } from "react-router-dom"
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
    taxonomy: boolean
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
  const [apiKeyOpen, setApiKeyOpen] = useState(false)
  const [apiKey, setApiKey] = useState("")

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

  const apiKeyMutation = useMutation({
    mutationFn: () => faireApi.connectApiKey(apiKey.trim()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: STATUS_KEY })
      setApiKeyOpen(false)
      setApiKey("")
      toast.success("Connected to Faire with API key")
    },
    onError: (err: any) =>
      toast.error("Failed to connect with API key", {
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
        {/* Nested @-routes (the @settings drawer) render here so they overlay
            the list instead of replacing it. */}
        <Outlet />
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
              <DropdownMenu>
                <DropdownMenu.Trigger asChild>
                  <Button size="small" variant="secondary">
                    Sync
                    <ChevronDownMini />
                  </Button>
                </DropdownMenu.Trigger>
                <DropdownMenu.Content>
                  <DropdownMenu.Item
                    onClick={() => navigate("/settings/faire/bulk")}
                  >
                    Bulk sync
                  </DropdownMenu.Item>
                  <DropdownMenu.Item
                    onClick={() => navigate("/settings/faire/settings")}
                  >
                    Sync settings
                  </DropdownMenu.Item>
                </DropdownMenu.Content>
              </DropdownMenu>
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
            <DropdownMenu>
              <DropdownMenu.Trigger asChild>
                <Button size="small" isLoading={connectMutation.isPending}>
                  Connect Faire
                  <ChevronDownMini />
                </Button>
              </DropdownMenu.Trigger>
              <DropdownMenu.Content>
                <DropdownMenu.Item onClick={() => connectMutation.mutate()}>
                  Connect with OAuth
                </DropdownMenu.Item>
                <DropdownMenu.Item onClick={() => setApiKeyOpen(true)}>
                  Connect with API key (private)
                </DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu>
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

      {/* API-key connect (private integrations) */}
      <Drawer open={apiKeyOpen} onOpenChange={setApiKeyOpen}>
        <Drawer.Content>
          <Drawer.Header>
            <Drawer.Title>Connect with API key</Drawer.Title>
          </Drawer.Header>
          <Drawer.Body className="flex flex-col gap-y-3">
            <Text className="text-ui-fg-subtle" size="small">
              For private / unpublished Faire integrations, paste the API key
              your Faire brand issued for this app. This connects without OAuth.
            </Text>
            <div className="flex flex-col gap-y-1">
              <Label size="small">Faire API key</Label>
              <Input
                type="password"
                placeholder="Paste the Faire API key…"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                autoComplete="off"
              />
            </div>
          </Drawer.Body>
          <Drawer.Footer>
            <Button
              variant="secondary"
              size="small"
              onClick={() => setApiKeyOpen(false)}
            >
              Cancel
            </Button>
            <Button
              size="small"
              onClick={() => apiKeyMutation.mutate()}
              isLoading={apiKeyMutation.isPending}
              disabled={!apiKey.trim()}
            >
              Connect
            </Button>
          </Drawer.Footer>
        </Drawer.Content>
      </Drawer>

      {/* Nested routes (e.g. @settings drawer) render here so they overlay the
          list instead of navigating away and blanking the page. */}
      <Outlet />

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

export const config = defineRouteConfig({
  label: "Faire",
  icon: BuildingStorefront,
})

export const handle = {
  breadcrumb: () => "Faire Sync",
}

export default FaireSettingsPage
