import {
  Heading,
  Text,
  DataTable,
  useDataTable,
  createDataTableFilterHelper,
  DataTablePaginationState,
  DataTableFilteringState,
  CommandBar,
  toast
} from "@medusajs/ui"
import { useParams } from "react-router-dom"
import { RouteFocusModal } from "../../modal/route-focus-modal"
import { AdminDesign, useDesigns } from "../../../hooks/api/designs"
import { useLinkProductDesign, useProduct } from "../../../hooks/api/products"
import { useState, useMemo, useEffect, useCallback } from "react"
import { useDesignColumns } from "./hooks/use-design-columns"

interface LinkDesignFormProps {
  productId?: string
}

const filterHelper = createDataTableFilterHelper<AdminDesign>()

export const LinkDesignForm = ({ productId }: LinkDesignFormProps) => {
  const { id } = useParams()
  const actualProductId = productId || id

  if (!actualProductId) {
    throw new Error("Product ID is required")
  }

  const [pagination, setPagination] = useState<DataTablePaginationState>({
    pageIndex: 0,
    pageSize: 10,
  })
  const [search, setSearch] = useState("")
  const [filtering, setFiltering] = useState<DataTableFilteringState>({})
  const [selectedRows, setSelectedRows] = useState<Record<string, boolean>>({})
  const [isCommandBarOpen, setIsCommandBarOpen] = useState(false)

  // Reset to first page whenever search changes
  const handleSearchChange = useCallback((value: string) => {
    setSearch(value)
    setPagination((prev) => ({ ...prev, pageIndex: 0 }))
  }, [])

  // Pass search (q) and active filters to the server — always global, never per-page
  const serverFilters = useMemo(() => {
    const f: Record<string, any> = {}
    if (filtering["status"]) f.status = filtering["status"]
    if (filtering["design_type"]) f.design_type = filtering["design_type"]
    if (filtering["priority"]) f.priority = filtering["priority"]
    return f
  }, [filtering])

  const { designs, count: totalCount = 0, isLoading: designsLoading } = useDesigns({
    limit: pagination.pageSize,
    offset: pagination.pageIndex * pagination.pageSize,
    q: search || undefined,
    ...serverFilters,
  })

  const { product, isLoading: productLoading } = useProduct(actualProductId, {
    fields: "*designs"
  })
  const { mutateAsync: linkDesign, isPending: isLinking } = useLinkProductDesign()

  const isLoading = designsLoading || productLoading || isLinking

  // Get already linked design IDs
  const linkedDesignIds = useMemo<Set<string>>(() => {
    const productWithDesigns = product as any
    if (!productWithDesigns?.designs || !Array.isArray(productWithDesigns.designs)) {
      return new Set<string>()
    }
    return new Set<string>(productWithDesigns.designs.map((d: any) => d.id))
  }, [product])

  // Exclude already-linked designs from the table (server already filtered by search)
  const availableDesigns = useMemo(() => {
    if (!designs || !Array.isArray(designs)) return []
    return designs.filter((design: AdminDesign) => !linkedDesignIds.has(design.id))
  }, [designs, linkedDesignIds])

  const handleRowSelect = useCallback((id: string) => {
    setSelectedRows(prev => ({
      ...prev,
      [id]: !prev[id]
    }))
  }, [])

  const filters = [
    filterHelper.accessor("status", {
      type: "select",
      label: "Status",
      options: [
        { label: "Conceptual", value: "Conceptual" },
        { label: "In Development", value: "In_Development" },
        { label: "Technical Review", value: "Technical_Review" },
        { label: "Commerce Ready", value: "Commerce_Ready" },
      ],
    }),
    filterHelper.accessor("design_type", {
      type: "select",
      label: "Type",
      options: [
        { label: "Fabric", value: "Fabric" },
        { label: "Pattern", value: "Pattern" },
        { label: "Garment", value: "Garment" },
        { label: "Accessory", value: "Accessory" },
      ],
    }),
    filterHelper.accessor("priority", {
      type: "select",
      label: "Priority",
      options: [
        { label: "High", value: "High" },
        { label: "Medium", value: "Medium" },
        { label: "Low", value: "Low" },
      ],
    }),
  ]

  const columns = useDesignColumns(selectedRows, handleRowSelect, linkedDesignIds)

  const table = useDataTable({
    columns,
    data: availableDesigns,
    getRowId: (row) => row.id,
    rowCount: totalCount,
    onRowClick: (_, row) => {
      if (!linkedDesignIds.has(row.id)) {
        handleRowSelect(row.id)
      }
    },
    isLoading,
    filters,
    pagination: {
      state: pagination,
      onPaginationChange: setPagination,
    },
    search: {
      state: search,
      onSearchChange: handleSearchChange,
    },
    filtering: {
      state: filtering,
      onFilteringChange: (next) => {
        setFiltering(next)
        setPagination((prev) => ({ ...prev, pageIndex: 0 }))
      },
    },
  })

  useEffect(() => {
    setIsCommandBarOpen(Object.keys(selectedRows).length > 0)
  }, [selectedRows])

  useEffect(() => {
    if (!isCommandBarOpen) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setSelectedRows({})
        setIsCommandBarOpen(false)
        e.preventDefault()
      }
    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [isCommandBarOpen])

  const linkDesignsToProduct = async () => {
    const selectedDesignIds = Object.keys(selectedRows).filter(id => selectedRows[id])
    if (selectedDesignIds.length === 0) return

    try {
      for (const designId of selectedDesignIds) {
        await linkDesign({
          productId: actualProductId,
          payload: { designId }
        })
      }
      toast.success("Designs linked successfully")
      setSelectedRows({})
      setIsCommandBarOpen(false)
    } catch {
      toast.error("Failed to link designs to product")
    }
  }

  return (
    <RouteFocusModal>
      <RouteFocusModal.Header></RouteFocusModal.Header>
      <CommandBar open={isCommandBarOpen}>
        <CommandBar.Bar>
          <CommandBar.Value>{Object.keys(selectedRows).length} selected</CommandBar.Value>
          <CommandBar.Command
            action={linkDesignsToProduct}
            label={isLinking ? "Linking..." : "Link to Product"}
            shortcut="l"
            disabled={isLinking}
          />
        </CommandBar.Bar>
      </CommandBar>
      <DataTable instance={table}>
        <DataTable.Toolbar className="flex justify-between items-center">
          <div>
            <Heading>Link Designs to Product</Heading>
            <Text className="text-ui-fg-subtle" size="small">
              Select designs to link to this product
            </Text>
          </div>
          <div className="flex items-center gap-x-2">
            <DataTable.Search />
            <DataTable.FilterMenu tooltip="Filter designs" />
          </div>
        </DataTable.Toolbar>
        <DataTable.Table />
        <DataTable.Pagination />
      </DataTable>
    </RouteFocusModal>
  )
}
