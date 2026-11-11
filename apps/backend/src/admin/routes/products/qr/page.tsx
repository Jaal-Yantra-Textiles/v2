import {
  Container,
  Heading,
  Text,
  DataTable,
  useDataTable,
  DataTablePaginationState,
  DataTableFilteringState,
  CommandBar,
  Checkbox,
  Badge,
  toast,
  createDataTableFilterHelper,
  Button,
  Input,
  Drawer,
} from "@medusajs/ui"
import { defineRouteConfig } from "@medusajs/admin-sdk"
import { Outlet } from "react-router-dom"
import { keepPreviousData } from "@tanstack/react-query"
import { useState, useMemo, useEffect, useCallback } from "react"
import debounce from "lodash/debounce"
import { Tag } from "@medusajs/icons"
import { useProducts } from "../../../hooks/api/products"
import { getProductUrlFromHandle } from "../../../lib/storefront-url"
import { useHangTagSettings } from "../../../hooks/api/hang-tag-settings"

// Minimal shape we rely on in the table
type AdminProductRow = {
  id: string
  title?: string | null
  handle?: string | null
  status?: string | null
  thumbnail?: string | null
  created_at?: string
}

import { fetchHangTagData } from "../../../components/hang-tag/generate-pdf"
import { HangTagReviewDrawer, ReviewTag } from "../../../components/hang-tag/review-drawer"

// ─── QR Params Modal ─────────────────────────────────────────────────────────

type QrParam = { key: string; value: string }

function QrParamsModal({
  open,
  defaultParams,
  onGenerate,
  onCancel,
}: {
  open: boolean
  defaultParams: QrParam[]
  onGenerate: (params: QrParam[]) => void
  onCancel: () => void
}) {
  const [params, setParams] = useState<QrParam[]>(defaultParams)

  // Sync params when modal opens
  useEffect(() => {
    if (open) setParams(defaultParams.map((p) => ({ ...p })))
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Drawer open={open} onOpenChange={(v) => { if (!v) onCancel() }}>
      <Drawer.Content>
        <Drawer.Header>
          <Drawer.Title>QR Tracking Parameters</Drawer.Title>
        </Drawer.Header>
        <Drawer.Body className="flex flex-col gap-y-4 p-6 overflow-y-auto">
          <Text size="small" className="text-ui-fg-subtle">
            These query parameters will be appended to the QR code URL for this generation.
            Pre-filled from your saved defaults — edit as needed.
          </Text>
          <div className="flex flex-col gap-y-2">
            {params.map((param, idx) => (
              <div key={idx} className="flex items-center gap-x-2">
                <Input
                  placeholder="key"
                  value={param.key}
                  onChange={(e) => {
                    const updated = [...params]
                    updated[idx] = { ...updated[idx], key: e.target.value }
                    setParams(updated)
                  }}
                  className="font-mono text-xs flex-1"
                />
                <span className="text-ui-fg-muted text-xs">=</span>
                <Input
                  placeholder="value"
                  value={param.value}
                  onChange={(e) => {
                    const updated = [...params]
                    updated[idx] = { ...updated[idx], value: e.target.value }
                    setParams(updated)
                  }}
                  className="font-mono text-xs flex-1"
                />
                <button
                  onClick={() => setParams(params.filter((_, i) => i !== idx))}
                  className="text-ui-fg-muted hover:text-ui-fg-error text-xs px-1"
                  title="Remove"
                >
                  ✕
                </button>
              </div>
            ))}
            <Button
              variant="transparent"
              size="small"
              onClick={() => setParams([...params, { key: "", value: "" }])}
              className="self-start text-ui-fg-subtle hover:text-ui-fg-base"
            >
              + Add parameter
            </Button>
          </div>
          {params.length === 0 && (
            <Text size="xsmall" className="text-ui-fg-muted">
              No parameters — QR codes will use the plain product URL.
            </Text>
          )}
        </Drawer.Body>
        <Drawer.Footer>
          <Button variant="secondary" onClick={onCancel}>Cancel</Button>
          <Button onClick={() => onGenerate(params)}>Generate</Button>
        </Drawer.Footer>
      </Drawer.Content>
    </Drawer>
  )
}

// ─── Main page component ──────────────────────────────────────────────────────

const QRGeneratorPage = () => {
  const [pagination, setPagination] = useState<DataTablePaginationState>({ pageSize: 10, pageIndex: 0 })
  const [filtering, setFiltering] = useState<DataTableFilteringState>({})
  const [search, setSearch] = useState<string>("")
  const [rowSelection, setRowSelection] = useState<Record<string, boolean>>({})
  const [isCommandBarOpen, setIsCommandBarOpen] = useState(false)
  const [isGeneratingQR, setIsGeneratingQR] = useState(false)
  const [isGeneratingTags, setIsGeneratingTags] = useState(false)
  const [qrParamsModalOpen, setQrParamsModalOpen] = useState(false)
  const [pendingAction, setPendingAction] = useState<"qr" | null>(null)
  const [reviewOpen, setReviewOpen] = useState(false)
  const [reviewTags, setReviewTags] = useState<ReviewTag[]>([])
  const [sessionParams, setSessionParams] = useState<{ key: string; value: string }[]>([])
  const { config: hangTagConfig } = useHangTagSettings()

  // Defensive: ensure body never stays with pointer-events: none due to overlay race conditions
  useEffect(() => {
    const fix = () => {
      if (typeof document !== "undefined" && document.body?.style?.pointerEvents === "none") {
        document.body.style.pointerEvents = ""
      }
    }
    fix()
    const observer = new MutationObserver(fix)
    observer.observe(document.body, { attributes: true, attributeFilter: ["style"] })
    return () => observer.disconnect()
  }, [])

  const handleFilterChange = useCallback((newFilters: DataTableFilteringState) => {
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
    return () => { debouncedSetSearch.cancel() }
  }, [debouncedSetSearch])

  const offset = pagination.pageIndex * pagination.pageSize

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
        if (key === "status") base.status = value as string
      }
    }
    return base
  }, [pagination.pageSize, offset, search, filtering])

  const { products, count, isLoading, isError, error } = useProducts(
    productsQuery,
    { placeholderData: keepPreviousData }
  ) as any

  const tableRows: AdminProductRow[] = useMemo(() => products ?? [], [products])

  const filteredRows: AdminProductRow[] = useMemo(() => {
    const rows = tableRows
    if (!filtering || Object.keys(filtering).length === 0) return rows
    return rows.filter((row: any) => {
      return Object.entries(filtering).every(([key, value]) => {
        if (!value) return true
        const v = row[key as keyof AdminProductRow] as any
        if (typeof value === "string") return (v ?? "").toString().toLowerCase().includes(value.toString().toLowerCase())
        if (Array.isArray(value)) return value.includes(((v ?? "") as string).toString().toLowerCase())
        if (typeof value === "object") {
          const date = v ? new Date(v) : null
          if (!date || isNaN(date.getTime())) return false
          let matching = true
          if ("$gte" in value && value.$gte) matching = matching && date >= new Date(value.$gte as number)
          if ("$lte" in value && value.$lte) matching = matching && date <= new Date(value.$lte as number)
          if ("$lt" in value && value.$lt) matching = matching && date < new Date(value.$lt as number)
          if ("$gt" in value && value.$gt) matching = matching && date > new Date(value.$gt as number)
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

  // ── URL builder with QR params ────────────────────────────────────────────────
  const buildQrUrl = (handle: string, params: { key: string; value: string }[]) => {
    const base = getProductUrlFromHandle(handle)
    const validParams = params.filter((p) => p.key)
    if (!validParams.length) return base
    const qs = validParams.map((p) => `${encodeURIComponent(p.key)}=${encodeURIComponent(p.value)}`).join("&")
    return `${base}?${qs}`
  }

  // ── Action: generate QR ZIP ───────────────────────────────────────────────────
  const generateQRCodes = async (params: { key: string; value: string }[]) => {
    const selectedIds = Object.keys(rowSelection).filter((id) => rowSelection[id])
    if (selectedIds.length === 0) return

    const selectedProducts = tableRows.filter((p) => selectedIds.includes(p.id))
    const valid = selectedProducts.filter((p) => !!p.handle)
    const invalid = selectedProducts.filter((p) => !p.handle)

    if (invalid.length) toast.warning(`${invalid.length} product(s) missing handle will be skipped`)

    setIsGeneratingQR(true)
    try {
      const { default: JSZip } = await import("jszip")
      const { saveAs } = await import("file-saver")
      const QRCodeZip = await import("qrcode")
      const zip = new JSZip()
      for (const item of valid) {
        const url = buildQrUrl(item.handle as string, params)
        const qrCanvas = document.createElement("canvas")
        await (QRCodeZip as any).toCanvas(qrCanvas, url, { width: 512, margin: 2 })
        const dataUrl = qrCanvas.toDataURL("image/png")
        const base64 = dataUrl.split(",")[1]
        zip.file(`${item.handle}.png`, base64, { base64: true })
      }
      const blob = await zip.generateAsync({ type: "blob" })
      saveAs(blob, `product-qrs-${Date.now()}.zip`)
      toast.success(`Generated ${valid.length} QR(s).`)
      setRowSelection({})
      setIsCommandBarOpen(false)
    } catch (e) {
      toast.error("Failed to generate QR codes")
    } finally {
      setIsGeneratingQR(false)
    }
  }

  // ── Action: load hang tag data, then review before printing (#2541) ─────────
  const openHangTagReview = async () => {
    const selectedIds = Object.keys(rowSelection).filter((id) => rowSelection[id])
    if (selectedIds.length === 0) return

    const selectedProducts = tableRows.filter((p) => selectedIds.includes(p.id))
    const valid = selectedProducts.filter((p) => !!p.handle)
    const invalid = selectedProducts.filter((p) => !p.handle)
    if (invalid.length) toast.warning(`${invalid.length} product(s) missing handle will be skipped`)
    if (valid.length === 0) return

    setIsGeneratingTags(true)
    try {
      const results = await Promise.allSettled(valid.map((p) => fetchHangTagData(p.id)))
      const tags: ReviewTag[] = []
      results.forEach((r, i) => {
        if (r.status === "fulfilled") tags.push({ key: valid[i].id, data: r.value })
        else toast.warning(`Skipped "${valid[i].title}": failed to fetch data`)
      })
      if (!tags.length) {
        toast.error("No hang tags could be prepared")
        return
      }
      setReviewTags(tags)
      setReviewOpen(true)
    } finally {
      setIsGeneratingTags(false)
    }
  }

  if (isError) throw error

  const selectedCount = Object.values(rowSelection).filter(Boolean).length
  const isBusy = isGeneratingQR || isGeneratingTags

  return (
    <div>
      <Container className="divide-y p-0">
        <CommandBar open={isCommandBarOpen}>
          <CommandBar.Bar>
            <CommandBar.Value>{selectedCount} selected</CommandBar.Value>
            <CommandBar.Seperator />
            <CommandBar.Command
              action={openHangTagReview}
              label={isGeneratingTags ? "Loading…" : "Hang Tags (PDF)"}
              disabled={isBusy}
              shortcut="h"
            />
            <CommandBar.Seperator />
            <CommandBar.Command
              action={() => {
                setSessionParams([...(hangTagConfig.qr_params ?? [])])
                setPendingAction("qr")
                setQrParamsModalOpen(true)
              }}
              label={isGeneratingQR ? "Generating…" : "QR Codes (ZIP)"}
              disabled={isBusy}
              shortcut="g"
            />
          </CommandBar.Bar>
        </CommandBar>

        <QrParamsModal
          open={qrParamsModalOpen}
          defaultParams={sessionParams}
          onGenerate={(params) => {
            setQrParamsModalOpen(false)
            if (pendingAction === "qr") generateQRCodes(params)
            setPendingAction(null)
          }}
          onCancel={() => {
            setQrParamsModalOpen(false)
            setPendingAction(null)
          }}
        />

        <HangTagReviewDrawer
          open={reviewOpen}
          onOpenChange={(o) => {
            setReviewOpen(o)
            if (!o) {
              setRowSelection({})
              setIsCommandBarOpen(false)
            }
          }}
          tags={reviewTags}
        />

        <DataTable instance={table}>
          <DataTable.Toolbar className="flex flex-col md:flex-row justify-between gap-y-4 px-6 py-4">
            <div>
              <Heading>QR &amp; Hang Tag Generator</Heading>
              <Text className="text-ui-fg-subtle" size="small">
                Select products to generate QR codes or print-ready hang tags with design &amp; partner info
              </Text>
            </div>
            <div className="flex items-center gap-x-2">
              <div className="w-full sm:max-w-[260px] md:w-auto">
                <DataTable.Search placeholder="Search products..." />
              </div>
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
  label: "QR & Hang Tags",
  nested: "/products",
  icon: Tag,
})

export const handle = {
  breadcrumb: () => "QR & Hang Tags",
}
