import {
  Container,
  Heading,
  Button,
  Text,
  Input,
  Label,
  Drawer,
  DataTable,
  DataTablePaginationState,
  useDataTable,
  toast,
  usePrompt,
} from "@medusajs/ui"
import { PencilSquare, Trash, SquareTwoStack, Plus } from "@medusajs/icons"
import { useNavigate } from "react-router-dom"
import { useCallback, useMemo, useState } from "react"
import { createColumnHelper } from "@tanstack/react-table"
import debounce from "lodash/debounce"
import {
  StatsDashboard,
  useDashboards,
  useCreateDashboard,
  useDeleteDashboard,
  useDuplicateDashboard,
} from "../../hooks/api/stats"
import { ActionMenu } from "../../components/common/action-menu"

const PAGE_SIZE = 20
const columnHelper = createColumnHelper<StatsDashboard>()

const StatsPage = () => {
  const navigate = useNavigate()
  const prompt = usePrompt()

  const [pagination, setPagination] = useState<DataTablePaginationState>({
    pageIndex: 0,
    pageSize: PAGE_SIZE,
  })
  const [search, setSearch] = useState("")
  const [createOpen, setCreateOpen] = useState(false)
  const [newName, setNewName] = useState("")
  const [newDescription, setNewDescription] = useState("")

  const offset = pagination.pageIndex * pagination.pageSize
  const { data, isLoading, isError, error } = useDashboards({
    limit: pagination.pageSize,
    offset,
    q: search || undefined,
  })

  const createDashboard = useCreateDashboard()
  const deleteDashboard = useDeleteDashboard()
  const duplicateDashboard = useDuplicateDashboard()

  const debouncedSetSearch = useCallback(
    debounce((v: string) => {
      setSearch(v)
      setPagination((p) => ({ ...p, pageIndex: 0 }))
    }, 300),
    []
  )

  const handleCreate = async () => {
    if (!newName.trim()) {
      toast.error("Name is required")
      return
    }
    try {
      const d = await createDashboard.mutateAsync({
        name: newName.trim(),
        description: newDescription.trim() || undefined,
      })
      toast.success("Dashboard created")
      setCreateOpen(false)
      setNewName("")
      setNewDescription("")
      navigate(`/stats/${d.id}`)
    } catch (e: any) {
      toast.error(`Failed: ${e.message}`)
    }
  }

  const handleDelete = async (d: StatsDashboard) => {
    const confirmed = await prompt({
      title: "Delete dashboard",
      description: `Delete "${d.name}" and all its panels?`,
      confirmText: "Delete",
      cancelText: "Cancel",
    })
    if (!confirmed) return
    deleteDashboard.mutate(d.id, {
      onSuccess: () => toast.success("Deleted"),
      onError: (e) => toast.error(`Failed: ${e.message}`),
    })
  }

  const handleDuplicate = (d: StatsDashboard) => {
    duplicateDashboard.mutate(d.id, {
      onSuccess: (copy) => {
        toast.success("Duplicated")
        navigate(`/stats/${copy.id}`)
      },
      onError: (e) => toast.error(`Failed: ${e.message}`),
    })
  }

  const columns = useMemo(
    () => [
      columnHelper.accessor("name", {
        header: "Name",
        cell: ({ getValue, row }) => (
          <div>
            <span className="font-medium">{getValue()}</span>
            {row.original.description && (
              <Text size="small" className="text-ui-fg-subtle">
                {row.original.description.slice(0, 80)}
              </Text>
            )}
          </div>
        ),
      }),
      columnHelper.accessor("created_at", {
        header: "Created",
        cell: ({ getValue }) => new Date(getValue()).toLocaleDateString(),
      }),
      columnHelper.display({
        id: "actions",
        cell: ({ row }) => {
          const d = row.original
          return (
            <ActionMenu
              groups={[
                {
                  actions: [
                    {
                      label: "Open",
                      icon: <PencilSquare />,
                      to: `/stats/${d.id}`,
                    },
                    {
                      label: "Duplicate",
                      icon: <SquareTwoStack />,
                      onClick: () => handleDuplicate(d),
                    },
                  ],
                },
                {
                  actions: [
                    {
                      label: "Delete",
                      icon: <Trash />,
                      onClick: () => handleDelete(d),
                    },
                  ],
                },
              ]}
            />
          )
        },
      }),
    ],
    [handleDelete, handleDuplicate]
  )

  const table = useDataTable({
    data: (data?.dashboards ?? []) as StatsDashboard[],
    columns,
    rowCount: data?.count ?? 0,
    getRowId: (row: StatsDashboard) => row.id,
    onRowClick: (_, row) => navigate(`/stats/${row.id}`),
    isLoading,
    pagination: {
      state: pagination,
      onPaginationChange: setPagination,
    },
    search: {
      state: search,
      onSearchChange: debouncedSetSearch,
    },
  })

  if (isError) throw error

  return (
    <>
      <Container className="divide-y p-0">
        <DataTable instance={table}>
          <DataTable.Toolbar className="flex flex-col md:flex-row justify-between gap-y-4 px-6 py-4">
            <div>
              <Heading>Stats</Heading>
              <Text className="text-ui-fg-subtle" size="small">
                Analytics dashboards built from the visual-flows operation registry.
              </Text>
            </div>
            <div className="flex flex-col sm:flex-row w-full md:w-auto gap-y-2 gap-x-2">
              <div className="w-full sm:max-w-[260px] md:w-auto">
                <DataTable.Search placeholder="Search dashboards..." />
              </div>
              <Button size="small" variant="primary" onClick={() => setCreateOpen(true)}>
                <Plus /> New dashboard
              </Button>
            </div>
          </DataTable.Toolbar>
          <DataTable.Table />
          <DataTable.Pagination />
        </DataTable>
      </Container>

      <Drawer open={createOpen} onOpenChange={setCreateOpen}>
        <Drawer.Content>
          <Drawer.Header>
            <Drawer.Title>New dashboard</Drawer.Title>
          </Drawer.Header>
          <Drawer.Body className="flex flex-col gap-y-4">
            <div>
              <Label size="small">Name</Label>
              <Input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="JYT Overview"
              />
            </div>
            <div>
              <Label size="small">Description (optional)</Label>
              <Input
                value={newDescription}
                onChange={(e) => setNewDescription(e.target.value)}
                placeholder="What this dashboard is for"
              />
            </div>
          </Drawer.Body>
          <Drawer.Footer>
            <div className="flex gap-2 justify-end w-full">
              <Drawer.Close asChild>
                <Button variant="secondary">Cancel</Button>
              </Drawer.Close>
              <Button
                onClick={handleCreate}
                isLoading={createDashboard.isPending}
              >
                Create
              </Button>
            </div>
          </Drawer.Footer>
        </Drawer.Content>
      </Drawer>
    </>
  )
}

// Sidebar entry removed — reached via /admin/operations hub. URL still works.

export const handle = {
  breadcrumb: () => "Stats",
}

export default StatsPage
