import {
  Button,
  Container,
  DataTable,
  DataTableFilteringState,
  DataTablePaginationState,
  DataTableRowSelectionState,
  FocusModal,
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
import { useEffect, useMemo, useState } from "react"
import { useNavigate } from "react-router-dom"
import { faireApi } from "../../../../lib/api"
import {
  BulkProduct,
  useBulkProductColumns,
} from "./use-bulk-product-columns"

const PAGE_SIZE = 12
const STATUS_KEY = ["faire", "status"]

const FaireBulkPage = () => {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(true)

  const [pagination, setPagination] = useState<DataTablePaginationState>({
    pageIndex: 0,
    pageSize: PAGE_SIZE,
  })
  const [filtering, setFiltering] = useState<DataTableFilteringState>({})
  const [search, setSearch] = useState("")
  const [rowSelection, setRowSelection] = useState<DataTableRowSelectionState>({})

  const statusQuery = useQuery({
    queryKey: STATUS_KEY,
    queryFn: () => faireApi.status() as Promise<any>,
  })
  const connected = !!statusQuery.data?.connected

  const productsQuery = useQuery({
    queryKey: ["faire", "bulk-products", pagination, filtering, search],
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const statusFilter = (filtering.status as any)?.[0] as string | undefined
      const res = await faireApi.listProducts({
        limit: pagination.pageSize,
        offset: pagination.pageIndex * pagination.pageSize,
        q: search || undefined,
        status: statusFilter,
        order: "-created_at",
      })
      return {
        products: (res as any).products || [],
        count: (res as any).count || 0,
      }
    },
  })

  const products = productsQuery.data?.products ?? []
  const count = productsQuery.data?.count ?? 0

  // Selection is keyed by product id. Track selected ids in a Set for the
  // command actions (the DataTable command bar's "select all" toggles across
  // all pages via the rowSelection state).
  const selectedIds = useMemo(
    () => Object.keys(rowSelection).filter((id) => rowSelection[id]),
    [rowSelection]
  )
  const allOnPageSelected =
    products.length > 0 && products.every((p) => rowSelection[p.id])

  const pushMutation = useMutation({
    mutationFn: (ids: string[]) => faireApi.syncBulk(ids),
    onSuccess: (res: any) => {
      toast.success("Bulk product sync started", {
        description: `Queued ${selectedIds.length} product(s). Batch ${res.batch_id}.`,
      })
      queryClient.invalidateQueries({ queryKey: ["faire", "syncs"] })
      setOpen(false)
    },
    onError: (err: any) =>
      toast.error("Failed to start bulk sync", { description: err.message }),
  })

  const columns = useBulkProductColumns()

  const commands = useMemo(
    () => [
      {
        label: "Push to Faire",
        shortcut: "p",
        action: (selection: DataTableRowSelectionState) => {
          const ids = Object.keys(selection).filter((id) => selection[id])
          if (!ids.length) {
            toast.error("Select at least one product")
            return
          }
          pushMutation.mutate(ids)
        },
      },
      {
        label: "Clear selection",
        shortcut: "c",
        action: () => setRowSelection({}),
      },
    ],
    [pushMutation]
  )

  const table = useDataTable({
    data: products as BulkProduct[],
    columns,
    rowCount: count,
    getRowId: (row: BulkProduct) => row.id,
    isLoading: productsQuery.isLoading,
    commands,
    rowSelection: {
      state: rowSelection,
      onRowSelectionChange: setRowSelection,
    },
    pagination: {
      state: pagination,
      onPaginationChange: setPagination,
    },
    filtering: {
      state: filtering,
      onFilteringChange: setFiltering,
    },
    search: {
      state: search,
      onSearchChange: setSearch,
    },
  })

  // When the modal closes, return to the Faire settings page.
  useEffect(() => {
    if (!open) navigate("/settings/faire", { replace: true })
  }, [open, navigate])

  return (
    <FocusModal open={open} onOpenChange={setOpen}>
      <FocusModal.Content className="flex flex-col">
        <FocusModal.Header className="border-b">
          <div className="flex flex-col">
            <Heading>Select products to push to Faire</Heading>
            <Text className="text-ui-fg-subtle" size="small">
              Use the command bar to push the selection to Faire as a background
              bulk sync.
            </Text>
          </div>
        </FocusModal.Header>
        <FocusModal.Body className="flex flex-1 flex-col overflow-hidden p-0">
          {!connected && (
            <div className="px-6 pt-4">
              <Text className="text-ui-fg-subtle" size="small">
                Faire is not connected — selections can be made but pushing is
                disabled.
              </Text>
            </div>
          )}
          <Container className="m-6 flex flex-1 flex-col overflow-hidden p-0">
            <DataTable instance={table}>
              <DataTable.Toolbar className="flex flex-col gap-y-4 px-6 py-4 md:flex-row md:items-center md:justify-between">
                <div className="flex items-center gap-x-2">
                  <Input
                    type="search"
                    placeholder="Search products…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="w-full md:w-64"
                  />
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
                    variant="secondary"
                    disabled={!products.length}
                    onClick={() => {
                      const next = { ...rowSelection }
                      products.forEach((p: any) => {
                        next[p.id] = !allOnPageSelected
                      })
                      setRowSelection(next)
                    }}
                  >
                    {allOnPageSelected ? "Deselect page" : "Select page"}
                  </Button>
                </div>
              </DataTable.Toolbar>
              {productsQuery.isLoading ? (
                <div className="flex flex-col gap-3 p-6">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <Skeleton key={i} className="h-10 w-full" />
                  ))}
                </div>
              ) : (
                <DataTable.Table />
              )}
              <DataTable.Pagination />
            </DataTable>
          </Container>
        </FocusModal.Body>
      </FocusModal.Content>
      <Toaster />
    </FocusModal>
  )
}

export const handle = {
  breadcrumb: () => "Bulk push",
}

export default FaireBulkPage
