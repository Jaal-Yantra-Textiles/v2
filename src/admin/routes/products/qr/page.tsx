import { Container, Heading, Text, DataTable, useDataTable, DataTablePaginationState, DataTableFilteringState, CommandBar, Checkbox, Badge, toast, createDataTableFilterHelper } from "@medusajs/ui"
import { defineRouteConfig } from "@medusajs/admin-sdk"
import { Outlet } from "react-router-dom"
import { keepPreviousData } from "@tanstack/react-query"
import { useState, useMemo, useEffect, useCallback } from "react"
import debounce from "lodash/debounce"
import { Tag } from "@medusajs/icons"
import { useProducts } from "../../../hooks/api/products"
import { getProductUrlFromHandle } from "../../../lib/storefront-url"


// Minimal shape we rely on in the table
type AdminProductRow = {
  id: string
  title?: string | null
  handle?: string | null
  status?: string | null
  thumbnail?: string | null
  created_at?: string
}

const QRGeneratorPage = () => {
  const [pagination, setPagination] = useState<DataTablePaginationState>({ pageSize: 10, pageIndex: 0 })
  const [filtering, setFiltering] = useState<DataTableFilteringState>({})
  const [search, setSearch] = useState<string>("")
  const [rowSelection, setRowSelection] = useState<Record<string, boolean>>({})
  const [isCommandBarOpen, setIsCommandBarOpen] = useState(false)
  const [isGenerating, setIsGenerating] = useState(false)

  // Defensive: ensure body never stays with pointer-events: none due to overlay race conditions
  useEffect(() => {
    const fix = () => {
      if (typeof document !== "undefined" && document.body?.style?.pointerEvents === "none") {
        document.body.style.pointerEvents = ""
      }
    }
    // Run immediately
    fix()
    // Observe body style changes
    const observer = new MutationObserver(fix)
    observer.observe(document.body, { attributes: true, attributeFilter: ["style"] })
    return () => observer.disconnect()
  }, [])

  // Synchronous filtering updates (prevents body pointer-events getting stuck in FilterMenu)
  const handleFilterChange = useCallback((newFilters: DataTableFilteringState) => {
    // Sanitize: drop undefined, null, empty string, and empty arrays
    const cleaned: DataTableFilteringState = {}
    if (newFilters) {
      for (const [key, value] of Object.entries(newFilters)) {
        const isEmptyArray = Array.isArray(value) && value.length === 0
        const isEmptyVal = value === undefined || value === null || value === "" || isEmptyArray
        if (!isEmptyVal) {
          cleaned[key] = value
        }
      }
    }
    setFiltering(cleaned)
    setPagination((prev) => ({ ...prev, pageIndex: 0 }))
    setRowSelection({})
  }, [])

  const debouncedSetSearch = useMemo(
    () => debounce((val: string) => setSearch(val), 300),
    []
  )

  const handleSearchChange = useCallback(
    (newSearch: string) => {
      debouncedSetSearch(newSearch)
      setPagination((prev) => ({ ...prev, pageIndex: 0 }))
      setRowSelection({})
    },
    [debouncedSetSearch]
  )

  useEffect(() => {
    return () => {
      debouncedSetSearch.cancel()
    }
  }, [debouncedSetSearch])

  const offset = pagination.pageIndex * pagination.pageSize

  // Map filtering state to products query params
  const productsQuery = useMemo(() => {
    const base: any = {
      limit: pagination.pageSize,
      offset,
      q: search || undefined,
    }
    if (filtering && Object.keys(filtering).length > 0) {
      for (const [key, value] of Object.entries(filtering)) {
        const isEmptyArray = Array.isArray(value) && value.length === 0
        const isEmptyVal = value === undefined || value === null || value === "" || isEmptyArray
        if (isEmptyVal) continue
        if (key === "status") {
          base.status = value as string
        }
        // add more mappings as needed (e.g., category_id)
      }
    }
    return base
  }, [pagination.pageSize, offset, search, filtering])

  const { products, count, isLoading, isError, error } = useProducts(
    productsQuery,
    {
      placeholderData: keepPreviousData,
    }
  ) as any

  const tableRows: AdminProductRow[] = useMemo(() => products ?? [], [products])

  // Client-side filtering (for the current page), mirroring the sample pattern
  const filteredRows: AdminProductRow[] = useMemo(() => {
    const rows = tableRows
    if (!filtering || Object.keys(filtering).length === 0) {
      return rows
    }
    return rows.filter((row: any) => {
      return Object.entries(filtering).every(([key, value]) => {
        if (!value) return true
        const v = row[key as keyof AdminProductRow] as any
        if (typeof value === "string") {
          return (v ?? "").toString().toLowerCase().includes(value.toString().toLowerCase())
        }
        if (Array.isArray(value)) {
          return value.includes(((v ?? "") as string).toString().toLowerCase())
        }
        if (typeof value === "object") {
          // Date range style matching if needed
          const date = v ? new Date(v) : null
          if (!date || isNaN(date.getTime())) return false
          let matching = true
          if ("$gte" in value && value.$gte) {
            matching = matching && date >= new Date(value.$gte as number)
          }
          if ("$lte" in value && value.$lte) {
            matching = matching && date <= new Date(value.$lte as number)
          }
          if ("$lt" in value && value.$lt) {
            matching = matching && date < new Date(value.$lt as number)
          }
          if ("$gt" in value && value.$gt) {
            matching = matching && date > new Date(value.$gt as number)
          }
          return matching
        }
        return true
      })
    })
  }, [tableRows, filtering])

  useEffect(() => {
    const anySelected = Object.values(rowSelection).some(Boolean)
    setIsCommandBarOpen(anySelected)
  }, [rowSelection])

  const columns = useMemo(() => {
    return [
      {
        id: "select",
        header: "",
        cell: ({ row }: any) => {
          const id = row.id as string
          const checked = !!rowSelection[id]
          return (
            <Checkbox
              id={`select-${id}`}
              checked={checked}
              onCheckedChange={() => setRowSelection((prev) => ({ ...prev, [id]: !prev[id] }))}
            />
          )
        },
        enableSorting: false,
        size: 36,
      },
      {
        id: "thumbnail",
        header: "Product",
        cell: ({ row }: any) => {
          const src = row.original.thumbnail as string | undefined
          return src ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={src} alt="thumb" className="h-8 w-8 rounded object-cover" />
          ) : (
            <div className="h-8 w-8 rounded bg-ui-bg-subtle" />
          )
        },
      },
      {
        id: "title",
        header: "Title",
        accessorKey: "title",
        cell: ({ row }: any) => row.original.title || "—",
      },
      {
        id: "handle",
        header: "Handle",
        accessorKey: "handle",
        cell: ({ row }: any) => {
          const handle = row.original.handle
          return (
            <div className="flex items-center gap-x-2">
              <span>{handle || "—"}</span>
              {!handle && <Badge size="xsmall" color="orange">Missing</Badge>}
            </div>
          )
        },
      },
      {
        id: "status",
        header: "Status",
        accessorKey: "status",
      },
    ]
  }, [rowSelection])

  // Filters for the FilterMenu
  const filterHelper = createDataTableFilterHelper<AdminProductRow>()
  const filters = useMemo(() => [
    filterHelper.accessor("status", {
      type: "select",
      label: "Status",
      options: [
        { label: "Draft", value: "draft" },
        { label: "Published", value: "published" },
      ],
    }),
  ], [])

  const table = useDataTable({
    columns,
    data: filteredRows,
    getRowId: (row) => row.id,
    rowCount: count,
    isLoading,
    onRowClick: () => {},
    filters,
    pagination: { state: pagination, onPaginationChange: setPagination },
    search: { state: search, onSearchChange: handleSearchChange },
    filtering: { state: filtering, onFilteringChange: handleFilterChange },
    rowSelection: { state: rowSelection, onRowSelectionChange: setRowSelection },
  })

  const generateQRCodes = async () => {
    const selectedIds = Object.keys(rowSelection).filter((id) => rowSelection[id])
    if (selectedIds.length === 0) return

    const selectedProducts = tableRows.filter((p) => selectedIds.includes(p.id))

    const toProcess = selectedProducts.map((p) => ({ id: p.id, title: p.title, handle: p.handle }))
    const valid = toProcess.filter((p) => !!p.handle)
    const invalid = toProcess.filter((p) => !p.handle)

    if (invalid.length) {
      toast.warning(`${invalid.length} product(s) missing handle will be skipped`)
    }

    setIsGenerating(true)
    try {
      const { default: JSZip } = await import("jszip")
      const { saveAs } = await import("file-saver")
      const { toDataURL } = await import("qrcode")
      const zip = new JSZip()
      for (const item of valid) {
        const url = getProductUrlFromHandle(item.handle as string)
        const dataUrl: string = await toDataURL(url, { width: 512, margin: 2 })
        const base64 = dataUrl.split(",")[1]
        const filename = `${item.handle}.png`
        zip.file(filename, base64, { base64: true })
      }
      const blob = await zip.generateAsync({ type: "blob" })
      saveAs(blob, `product-qrs-${Date.now()}.zip`)
      toast.success(`Generated ${valid.length} QR(s).`)
      setRowSelection({})
      setIsCommandBarOpen(false)
    } catch (e) {
      toast.error("Failed to generate QR codes")
    } finally {
      setIsGenerating(false)
    }
  }

  if (isError) {
    throw error
  }

  const selectedCount = Object.values(rowSelection).filter(Boolean).length

  return (
    <div>
      <Container className="divide-y p-0">
        <CommandBar open={isCommandBarOpen}>
          <CommandBar.Bar>
            <CommandBar.Value>{selectedCount} selected</CommandBar.Value>
            <CommandBar.Command
              action={generateQRCodes}
              label={isGenerating ? "Generating..." : "Generate QR (ZIP)"}
              disabled={isGenerating}
              shortcut="g"
            />
          </CommandBar.Bar>
        </CommandBar>

        <DataTable instance={table}>
          <DataTable.Toolbar className="flex flex-col md:flex-row justify-between gap-y-4 px-6 py-4">
            <div>
              <Heading>QR Generator</Heading>
              <Text className="text-ui-fg-subtle" size="small">
                Select products and generate QR codes pointing to the storefront product URL
              </Text>
            </div>
            <div className="flex items-center gap-x-2">
              <div className="w-full sm:max-w-[260px] md:w-auto">
                <DataTable.Search placeholder="Search products..." />
              </div>
              {/* Clear selection when opening Filter menu to avoid overlay/pointer-events conflicts */}
              <div onMouseDown={() => setRowSelection({})}>
                <DataTable.FilterMenu tooltip="Filter products" />
              </div>
            </div>
          </DataTable.Toolbar>
          <DataTable.Table />
          <DataTable.Pagination />
        </DataTable>
      </Container>
      <Outlet />
    </div>
  )
}

export default QRGeneratorPage

export const config = defineRouteConfig({
  label: "QR Generator",
  nested: "/products",
  icon: Tag,
})

export const handle = {
  breadcrumb: () => "QR Generator",
}
