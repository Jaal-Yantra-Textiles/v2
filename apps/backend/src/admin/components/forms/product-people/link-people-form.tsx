import { Heading, Text, DataTable, useDataTable, DataTablePaginationState, DataTableFilteringState, CommandBar, toast, Checkbox } from "@medusajs/ui"
import { useParams } from "react-router-dom"
import { RouteFocusModal } from "../../modal/route-focus-modal"
import { usePersons } from "../../../hooks/api/persons"
import { useLinkProductPerson, useProduct } from "../../../hooks/api/products"
import { useState, useMemo, useEffect } from "react"

export const LinkPeopleForm = ({ productId: overrideProductId }: { productId?: string }) => {
  const { id } = useParams()
  const productId = overrideProductId || id

  if (!productId) {
    throw new Error("Product ID is required")
  }

  // Pagination
  const [pagination, setPagination] = useState<DataTablePaginationState>({ pageIndex: 0, pageSize: 10 })
  const [search, setSearch] = useState("")

  // Fetch people with server-side search
  const { persons = [], count: totalCount = 0, isLoading: personsLoading } = usePersons({
    limit: pagination.pageSize,
    offset: pagination.pageIndex * pagination.pageSize,
    // Pass search query to API for global filtering
    ...(search ? { q: search } : {}),
  })

  // Fetch current product's direct people to disable already-linked rows
  const { product, isLoading: productLoading } = useProduct(productId, { fields: "*people" }) as any

  const { mutateAsync: linkPerson, isPending: isLinking } = useLinkProductPerson()

  const [selectedRows, setSelectedRows] = useState<Record<string, boolean>>({})
  const [isCommandBarOpen, setIsCommandBarOpen] = useState(false)
  const [filtering, setFiltering] = useState<DataTableFilteringState>({})

  const isLoading = personsLoading || productLoading || isLinking

  const linkedPersonIds = useMemo<Set<string>>(() => {
    const arr = (product as any)?.people || []
    return new Set<string>(arr.map((p: any) => p.id))
  }, [product])

  // Reset to first page when search changes
  const handleSearchChange = (value: string) => {
    setSearch(value)
    // Reset to first page when search query changes
    setPagination((prev) => ({ ...prev, pageIndex: 0 }))
  }

  // Columns
  const columns = [
    {
      id: "select",
      header: "",
      cell: ({ row }: any) => {
        const id = row.id as string
        const disabled = linkedPersonIds.has(id)
        const checked = !!selectedRows[id]
        return (
          <Checkbox
            id={`select-${id}`}
            checked={checked}
            disabled={disabled}
            onCheckedChange={() => {
              setSelectedRows((prev) => ({ ...prev, [id]: !prev[id] }))
            }}
          />
        )
      },
      enableSorting: false,
      size: 36,
    },
    {
      id: "first_name",
      header: "First Name",
      accessorKey: "first_name",
      cell: ({ row }: any) => row.original.first_name || "—",
    },
    {
        id: "last_name",
        header: "Last Name",
        accessorKey: "last_name",
        cell: ({ row }: any) => row.original.last_name || "—",
      },
    {
      id: "email",
      header: "Email",
      accessorKey: "email",
      cell: ({ row }: any) => row.original.email || "—",
    },
  ]

  const table = useDataTable({
    columns,
    data: persons as any[],
    getRowId: (row) => row.id,
    rowCount: totalCount,
    onRowClick: (_, row) => {
      const id = row.id
      if (!linkedPersonIds.has(id)) {
        setSelectedRows((prev) => ({ ...prev, [id]: !prev[id] }))
      }
    },
    isLoading,
    filters: [],
    pagination: { state: pagination, onPaginationChange: setPagination },
    search: { state: search, onSearchChange: handleSearchChange },
    filtering: { state: filtering, onFilteringChange: setFiltering },
    rowSelection: {
      state: selectedRows,
      onRowSelectionChange: setSelectedRows,
      enableRowSelection: (row) => !linkedPersonIds.has(row.id as string),
    },
  })

  useEffect(() => {
    const hasSelections = Object.keys(selectedRows).some((k) => selectedRows[k])
    setIsCommandBarOpen(hasSelections)
  }, [selectedRows])

  useEffect(() => {
    const handleEscapeKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && isCommandBarOpen) {
        setSelectedRows({})
        setIsCommandBarOpen(false)
        event.preventDefault()
      }
    }
    if (isCommandBarOpen) {
      window.addEventListener("keydown", handleEscapeKey)
    }
    return () => window.removeEventListener("keydown", handleEscapeKey)
  }, [isCommandBarOpen])

  const linkSelectedPeople = async () => {
    const ids = Object.keys(selectedRows).filter((id) => selectedRows[id])
    if (ids.length === 0) return

    try {
      for (const personId of ids) {
        await linkPerson({ productId, payload: { personId } })
      }
      toast.success("People linked successfully")
      setSelectedRows({})
      setIsCommandBarOpen(false)
    } catch (e) {
      toast.error("Failed to link people to product")
    }
  }

  return (
    <RouteFocusModal>
      <RouteFocusModal.Header />
      <CommandBar open={isCommandBarOpen}>
        <CommandBar.Bar>
          <CommandBar.Value>{Object.keys(selectedRows).filter((id) => selectedRows[id]).length} selected</CommandBar.Value>
          <CommandBar.Command action={linkSelectedPeople} label={isLinking ? "Linking..." : "Link to Product"} shortcut="l" disabled={isLinking} />
        </CommandBar.Bar>
      </CommandBar>

      <DataTable instance={table}>
        <DataTable.Toolbar className="flex justify-between items-center">
          <div>
            <Heading>Link People to Product</Heading>
            <Text className="text-ui-fg-subtle" size="small">Select people to link to this product</Text>
          </div>
          <div className="flex items-center gap-x-2">
            <DataTable.Search />
          </div>
        </DataTable.Toolbar>
        <DataTable.Table />
        <DataTable.Pagination />
      </DataTable>
    </RouteFocusModal>
  )
}

export default LinkPeopleForm
