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

  const { designs, isLoading: designsLoading } = useDesigns()
  const { product, isLoading: productLoading } = useProduct(actualProductId, {
    fields: "*designs"
  })
  const { mutateAsync: linkDesign, isPending: isLinking } = useLinkProductDesign()
  
  const [selectedRows, setSelectedRows] = useState<Record<string, boolean>>({})
  const [isCommandBarOpen, setIsCommandBarOpen] = useState(false)
  const [pagination, setPagination] = useState<DataTablePaginationState>({
    pageIndex: 0,
    pageSize: 10,
  })
  const [search, setSearch] = useState("")
  const [filtering, setFiltering] = useState<DataTableFilteringState>({})

  const isLoading = designsLoading || productLoading || isLinking

  // Get already linked design IDs
  const linkedDesignIds = useMemo<Set<string>>(() => {
    // Check if product has designs property (it might be extended with relations)
    const productWithDesigns = product as any
    if (!productWithDesigns?.designs || !Array.isArray(productWithDesigns.designs)) {
      return new Set<string>()
    }
    return new Set<string>(productWithDesigns.designs.map((d: any) => d.id))
  }, [product])

  // Filter designs to exclude already linked ones
  const availableDesigns = useMemo(() => {
    if (!designs || !Array.isArray(designs)) return []
    
    return designs.filter((design: AdminDesign) => {
      return !linkedDesignIds.has(design.id)
    })
  }, [designs, linkedDesignIds])

  // Apply search and filtering
  const filteredItems = useMemo(() => {
    let filtered = [...availableDesigns]

    // Apply search
    if (search) {
      const query = search.toLowerCase()
      filtered = filtered.filter((design) => {
        return (
          design.name?.toLowerCase().includes(query) ||
          design.status?.toLowerCase().includes(query) ||
          design.design_type?.toLowerCase().includes(query) ||
          design.description?.toLowerCase().includes(query)
        )
      })
    }

    // Apply filters
    filtered = filtered.filter((item) => {
      return Object.entries(filtering).every(([key, value]) => {
        if (!value) {
          return true
        }
        
        // Get the actual value based on the key
        const itemValue = item[key as keyof AdminDesign]
        return itemValue === value
      })
    })

    return filtered
  }, [availableDesigns, search, filtering])

  const handleRowSelect = useCallback((id: string) => {
    setSelectedRows(prev => ({
      ...prev,
      [id]: !prev[id]
    }))
  }, [])

  // Create filters
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

  // Paginated items
  const paginatedItems = useMemo(() => {
    const start = pagination.pageIndex * pagination.pageSize
    const end = start + pagination.pageSize
    return filteredItems.slice(start, end)
  }, [filteredItems, pagination])

  // Create columns
  const columns = useDesignColumns(selectedRows, handleRowSelect, linkedDesignIds)

  // Create table
  const table = useDataTable({
    columns: columns,
    data: paginatedItems,
    getRowId: (row) => row.id,
    rowCount: filteredItems.length,
    onRowClick: (_, row) => {
      const rowId = row.id
      if (!linkedDesignIds.has(rowId)) {
        handleRowSelect(rowId)
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
      onSearchChange: setSearch
    },
    filtering: {
      state: filtering,
      onFilteringChange: setFiltering,
    },
  })

  // Update command bar visibility when selections change
  useEffect(() => {
    const hasSelections = Object.keys(selectedRows).length > 0
    setIsCommandBarOpen(hasSelections)
  }, [selectedRows])

  // Add escape key handler to clear selections
  useEffect(() => {
    const handleEscapeKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && isCommandBarOpen) {
        setSelectedRows({})
        setIsCommandBarOpen(false)
        // Prevent default behavior to avoid conflicts with other handlers
        event.preventDefault()
      }
    }

    // Add the event listener when the command bar is open
    if (isCommandBarOpen) {
      window.addEventListener('keydown', handleEscapeKey)
    }
    
    return () => {
      window.removeEventListener('keydown', handleEscapeKey)
    }
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
      
      // Clear selections and close command bar
      setSelectedRows({})
      setIsCommandBarOpen(false)
    } catch (error) {
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
