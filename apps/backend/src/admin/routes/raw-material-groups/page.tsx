import { defineRouteConfig } from "@medusajs/admin-sdk"
import { Swatch } from "@medusajs/icons"
import {
  Button,
  Container,
  DataTable,
  DataTableFilteringState,
  DataTablePaginationState,
  Heading,
  Input,
  Label,
  Text,
  Textarea,
  FocusModal,
  Badge,
  createDataTableColumnHelper,
  createDataTableFilterHelper,
  toast,
  useDataTable,
} from "@medusajs/ui"
import { useMemo, useState } from "react"
import { useNavigate } from "react-router-dom"
import {
  RawMaterialGroup,
  useRawMaterialGroups,
  useCreateRawMaterialGroup,
} from "../../hooks/api/raw-material-groups"

const CreateGroupModal = () => {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState("")
  const [composition, setComposition] = useState("")
  const { mutateAsync, isPending } = useCreateRawMaterialGroup()

  const submit = async () => {
    if (!name.trim()) {
      toast.error("Name is required")
      return
    }
    try {
      await mutateAsync({ name: name.trim(), composition: composition.trim() || undefined })
      toast.success("Group created")
      setOpen(false)
      setName("")
      setComposition("")
    } catch (e: any) {
      toast.error(e?.message || "Failed to create group")
    }
  }

  return (
    <FocusModal open={open} onOpenChange={setOpen}>
      <FocusModal.Trigger asChild>
        <Button size="small" variant="secondary">Create group</Button>
      </FocusModal.Trigger>
      <FocusModal.Content>
        <FocusModal.Header>
          <Button size="small" onClick={submit} isLoading={isPending}>Save</Button>
        </FocusModal.Header>
        <FocusModal.Body className="flex flex-col items-center py-16">
          <div className="flex w-full max-w-lg flex-col gap-y-6">
            <div>
              <FocusModal.Title asChild>
                <Heading>New raw-material group</Heading>
              </FocusModal.Title>
              <FocusModal.Description asChild>
                <Text size="small" className="text-ui-fg-subtle">
                  A group ties per-color materials together (e.g. "Cotton Poplin" in blue / red / green).
                </Text>
              </FocusModal.Description>
            </div>
            <div className="flex flex-col gap-y-2">
              <Label>Name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Cotton Poplin" />
            </div>
            <div className="flex flex-col gap-y-2">
              <Label>Composition</Label>
              <Textarea value={composition} onChange={(e) => setComposition(e.target.value)} placeholder="100% Cotton" />
            </div>
          </div>
        </FocusModal.Body>
      </FocusModal.Content>
    </FocusModal>
  )
}

const columnHelper = createDataTableColumnHelper<RawMaterialGroup>()
const filterHelper = createDataTableFilterHelper<RawMaterialGroup>()

const columns = [
  columnHelper.accessor("name", {
    header: "Name",
    enableSorting: true,
  }),
  columnHelper.accessor("composition", {
    header: "Composition",
    cell: ({ getValue }) => (
      <span className="text-ui-fg-subtle">{getValue() || "—"}</span>
    ),
  }),
  columnHelper.display({
    id: "colors",
    header: "Colors",
    cell: ({ row }) => row.original.raw_materials?.length ?? 0,
  }),
  columnHelper.accessor("status", {
    header: "Status",
    cell: ({ getValue }) => {
      const status = getValue() || "Active"
      return (
        <Badge size="small" color={status === "Active" ? "green" : "grey"}>
          {status}
        </Badge>
      )
    },
  }),
]

const filters = [
  filterHelper.accessor("status", {
    type: "select",
    label: "Status",
    options: [
      { label: "Active", value: "Active" },
      { label: "Discontinued", value: "Discontinued" },
      { label: "Under Review", value: "Under_Review" },
      { label: "Development", value: "Development" },
    ],
  }),
]

const PAGE_SIZE = 20

const RawMaterialGroupsPage = () => {
  const navigate = useNavigate()

  const [pagination, setPagination] = useState<DataTablePaginationState>({
    pageIndex: 0,
    pageSize: PAGE_SIZE,
  })
  const [filtering, setFiltering] = useState<DataTableFilteringState>({})
  const [search, setSearch] = useState("")

  const statusFilter = filtering.status
  const status = Array.isArray(statusFilter)
    ? (statusFilter[0] as string | undefined)
    : (statusFilter as string | undefined)

  const { data, isLoading } = useRawMaterialGroups({
    q: search || undefined,
    status: status || undefined,
    limit: pagination.pageSize,
    offset: pagination.pageIndex * pagination.pageSize,
  })

  const groups = useMemo(() => data?.raw_material_groups ?? [], [data])

  const table = useDataTable({
    columns,
    data: groups,
    getRowId: (row) => row.id,
    rowCount: data?.count ?? 0,
    isLoading,
    onRowClick: (_, row) => navigate(`/raw-material-groups/${row.id}`),
    filters,
    pagination: {
      state: pagination,
      onPaginationChange: setPagination,
    },
    search: {
      state: search,
      onSearchChange: setSearch,
    },
    filtering: {
      state: filtering,
      onFilteringChange: setFiltering,
    },
  })

  return (
    <Container className="divide-y p-0">
      <DataTable instance={table}>
        <DataTable.Toolbar className="flex items-center justify-between px-6 py-4">
          <div>
            <Heading level="h1">Material Groups</Heading>
            <Text size="small" className="text-ui-fg-subtle">
              Order a material in multiple colors without losing color identity.
            </Text>
          </div>
          <div className="flex items-center gap-x-2">
            <DataTable.Search placeholder="Search groups" />
            <DataTable.FilterMenu tooltip="Filter groups" />
            <CreateGroupModal />
          </div>
        </DataTable.Toolbar>
        <DataTable.Table />
        <DataTable.Pagination />
      </DataTable>
    </Container>
  )
}

export const config = defineRouteConfig({
  label: "Material Groups",
  icon: Swatch,
  // Nest under the core Inventory menu instead of a top-level Extensions item.
  nested: "/inventory",
})

export default RawMaterialGroupsPage
