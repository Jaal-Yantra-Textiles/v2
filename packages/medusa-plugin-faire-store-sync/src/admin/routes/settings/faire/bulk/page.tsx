import {
  Badge,
  Button,
  DataTable,
  DataTableFilteringState,
  DataTablePaginationState,
  DataTableRowSelectionState,
  Heading,
  Input,
  Skeleton,
  Text,
  Toaster,
  toast,
  useDataTable,
} from "@medusajs/ui"
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import { useMemo, useState } from "react"
import { faireApi, sdk } from "../../../../lib/api"
import { RouteFocusModal } from "../../../../components/route-focus-modal"
import {
  BulkProduct,
  useBulkProductColumns,
} from "./use-bulk-product-columns"

const PAGE_SIZE = 20
const PRODUCT_FIELDS = "id,title,status,thumbnail,handle,created_at,updated_at"
// Safety cap for "select all matching" — a runaway catalog shouldn't queue an
// unbounded batch. If the match set exceeds this, we sync the first N and warn.
const SELECT_ALL_CAP = 2000

type ProductListResult = { products: BulkProduct[]; count: number }

// Reuse the Medusa admin SDK's product list instead of a bespoke fetch wrapper.
const listProducts = (query: Record<string, string | number | undefined>) =>
  sdk.admin.product.list({
    fields: PRODUCT_FIELDS,
    ...query,
  }) as unknown as Promise<ProductListResult>

const FaireBulkPage = () => {
  const queryClient = useQueryClient()

  const [pagination, setPagination] = useState<DataTablePaginationState>({
    pageIndex: 0,
    pageSize: PAGE_SIZE,
  })
  const [filtering, setFiltering] = useState<DataTableFilteringState>({})
  const [search, setSearch] = useState("")
  const [rowSelection, setRowSelection] = useState<DataTableRowSelectionState>({})
  // When true, the action targets every product matching the current search /
  // filter across all pages — not just the rows selected on screen.
  const [selectAllMatching, setSelectAllMatching] = useState(false)

  const statusFilter = (filtering.status as any)?.[0] as string | undefined

  const statusQuery = useQuery({
    queryKey: ["faire", "status"],
    queryFn: () => faireApi.status() as Promise<any>,
  })
  const connected = !!statusQuery.data?.connected

  const productsQuery = useQuery({
    queryKey: ["faire", "bulk-products", pagination, statusFilter, search],
    placeholderData: keepPreviousData,
    queryFn: () =>
      listProducts({
        limit: pagination.pageSize,
        offset: pagination.pageIndex * pagination.pageSize,
        q: search || undefined,
        status: statusFilter,
        order: "-created_at",
      }),
  })

  const products = productsQuery.data?.products ?? []
  const count = productsQuery.data?.count ?? 0

  const selectedIds = useMemo(
    () => Object.keys(rowSelection).filter((id) => rowSelection[id]),
    [rowSelection]
  )
  const targetCount = selectAllMatching ? count : selectedIds.length

  // Resolve the id set to sync: either the explicit selection, or every product
  // matching the current query (paged out, capped).
  const resolveTargetIds = async (): Promise<string[]> => {
    if (!selectAllMatching) return selectedIds
    const ids: string[] = []
    let offset = 0
    while (ids.length < count && ids.length < SELECT_ALL_CAP) {
      const res = await listProducts({
        limit: 200,
        offset,
        q: search || undefined,
        status: statusFilter,
        order: "-created_at",
      })
      const batch = res.products ?? []
      if (!batch.length) break
      ids.push(...batch.map((p) => p.id))
      offset += batch.length
    }
    return ids.slice(0, SELECT_ALL_CAP)
  }

  const pushMutation = useMutation({
    mutationFn: async () => {
      const ids = await resolveTargetIds()
      if (!ids.length) throw new Error("No products to sync")
      const res = await faireApi.syncBulk(ids)
      return { res, queued: ids.length }
    },
    onSuccess: ({ res, queued }: any) => {
      toast.success("Bulk product sync started", {
        description:
          `Queued ${queued} product(s). Batch ${res.batch_id}.` +
          (selectAllMatching && count > SELECT_ALL_CAP
            ? ` Capped at ${SELECT_ALL_CAP} — run again for the rest.`
            : ""),
      })
      queryClient.invalidateQueries({ queryKey: ["faire", "syncs"] })
      setRowSelection({})
      setSelectAllMatching(false)
    },
    onError: (err: any) =>
      toast.error("Failed to start bulk sync", { description: err.message }),
  })

  const columns = useBulkProductColumns()

  const commands = useMemo(
    () => [
      {
        label: connected ? "Push to Faire" : "Connect Faire first",
        shortcut: "p",
        action: () => {
          if (!connected) {
            toast.error("Faire is not connected")
            return
          }
          pushMutation.mutate()
        },
      },
      {
        label: "Clear selection",
        shortcut: "c",
        action: () => {
          setRowSelection({})
          setSelectAllMatching(false)
        },
      },
    ],
    [connected, pushMutation]
  )

  const table = useDataTable({
    data: products,
    columns,
    rowCount: count,
    getRowId: (row) => row.id,
    isLoading: productsQuery.isLoading,
    commands,
    rowSelection: {
      state: rowSelection,
      onRowSelectionChange: (updater) => {
        setSelectAllMatching(false)
        setRowSelection(updater)
      },
    },
    pagination: { state: pagination, onPaginationChange: setPagination },
    filtering: { state: filtering, onFilteringChange: setFiltering },
    search: { state: search, onSearchChange: setSearch },
  })

  return (
    <RouteFocusModal prev="/settings/faire">
      <RouteFocusModal.Header>
        <div className="flex flex-col">
          <Heading>Bulk sync products to Faire</Heading>
          <Text className="text-ui-fg-subtle" size="small">
            Select products (or all matching) and push them to Faire as a
            background sync via the command bar.
          </Text>
        </div>
      </RouteFocusModal.Header>
      <RouteFocusModal.Body className="flex flex-1 flex-col overflow-hidden p-0">
        <DataTable instance={table}>
          <DataTable.Toolbar className="flex flex-col gap-y-3 border-b px-6 py-4">
            <div className="flex flex-col gap-y-2 md:flex-row md:items-center md:justify-between">
              <div className="flex items-center gap-x-2">
                <Input
                  type="search"
                  placeholder="Search products…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-full md:w-72"
                />
                {!connected && (
                  <Badge color="orange" size="2xsmall">
                    Not connected
                  </Badge>
                )}
              </div>
              <div className="flex items-center gap-x-2">
                <Button
                  size="small"
                  variant="secondary"
                  onClick={() => productsQuery.refetch()}
                  isLoading={productsQuery.isFetching}
                >
                  Refresh
                </Button>
                <Button
                  size="small"
                  variant={selectAllMatching ? "primary" : "secondary"}
                  disabled={!count}
                  onClick={() => {
                    setRowSelection({})
                    setSelectAllMatching((v) => !v)
                  }}
                >
                  {selectAllMatching
                    ? `All ${count} selected`
                    : `Select all ${count}`}
                </Button>
              </div>
            </div>
            {targetCount > 0 && (
              <Text size="small" className="text-ui-fg-subtle">
                {selectAllMatching
                  ? `All ${count} matching product(s) will be synced`
                  : `${targetCount} product(s) selected`}
                {pushMutation.isPending ? " — queuing…" : ""}
              </Text>
            )}
          </DataTable.Toolbar>
          {productsQuery.isLoading ? (
            <div className="flex flex-col gap-3 p-6">
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : (
            <DataTable.Table />
          )}
          <DataTable.Pagination />
        </DataTable>
      </RouteFocusModal.Body>
      <Toaster />
    </RouteFocusModal>
  )
}

export const handle = {
  breadcrumb: () => "Bulk sync",
}

export default FaireBulkPage
