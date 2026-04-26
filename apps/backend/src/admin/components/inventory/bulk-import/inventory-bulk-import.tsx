import React, { useCallback, useEffect, useMemo, useState } from "react"
import { useForm, useFieldArray, useWatch } from "react-hook-form"
import { ColumnDef } from "@tanstack/react-table"
import {
  Button,
  Heading,
  IconButton,
  ProgressStatus,
  ProgressTabs,
  Select,
  Text,
  toast,
  Tooltip,
} from "@medusajs/ui"
import { Photo, Plus, Trash } from "@medusajs/icons"
import { RouteFocusModal } from "../../modal/route-focus-modal"
import { useRouteModal } from "../../modal/use-route-modal"
import { KeyboundForm } from "../../utilitites/key-bound-form"
import { Form } from "../../common/form"
import { DataGrid } from "../../data-grid/data-grid"
import { DataGridTextCell } from "../../data-grid/components/data-grid-text-cell"
import { DataGridSelectCell } from "../../data-grid/components/data-grid-select-cell"
import { DataGridReadonlyCell } from "../../data-grid/components/data-grid-readonly-cell"
import { createDataGridHelper } from "../../data-grid/helpers/create-data-grid-column-helper"
import { useStockLocations } from "../../../hooks/api/stock_location"
import { useBulkImportInventory } from "../../../hooks/api/inventory-bulk-import"
import { useRawMaterialCategories } from "../../../hooks/api/raw-materials"
import ProductMediaModal from "../../media/product-media-modal"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface BulkImportRow {
  name: string
  composition: string
  color: string
  unit_of_measure: string
  media: string[]
  material_type: string
}

interface BulkImportFormValues {
  stock_location_id: string
  items: BulkImportRow[]
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const EMPTY_ROW: BulkImportRow = {
  name: "",
  composition: "",
  color: "",
  unit_of_measure: "Other",
  media: [],
  material_type: "",
}

const UNIT_OPTIONS = [
  { label: "Meter", value: "Meter" },
  { label: "Yard", value: "Yard" },
  { label: "Kilogram", value: "Kilogram" },
  { label: "Gram", value: "Gram" },
  { label: "Piece", value: "Piece" },
  { label: "Roll", value: "Roll" },
  { label: "Other", value: "Other" },
]

const S3_PREFIX = process.env.NEXT_PUBLIC_AWS_S3 || ""

const columnHelper = createDataGridHelper<BulkImportRow, BulkImportFormValues>()

enum Tab {
  GENERAL = "general",
  ITEMS = "items",
}

type TabState = Record<Tab, ProgressStatus>

// ---------------------------------------------------------------------------
// MediaCell – subscribes only to its own row to avoid full-grid re-renders
// ---------------------------------------------------------------------------

const MediaCell = ({
  context,
  onOpenMedia,
}: {
  context: any
  onOpenMedia: (index: number) => void
}) => {
  const rowIndex = context.row.index
  const media: string[] =
    useWatch({ name: `items.${rowIndex}.media` }) || []
  const hasMedia = media.length > 0
  const thumbUrl = hasMedia ? `${S3_PREFIX}${media[0]}` : null

  return (
    <DataGridReadonlyCell context={context} color="normal">
      <button
        type="button"
        className="flex items-center gap-1.5 w-full h-full"
        onClick={(e) => {
          e.stopPropagation()
          onOpenMedia(rowIndex)
        }}
      >
        {thumbUrl ? (
          <img
            src={thumbUrl}
            alt=""
            className="h-6 w-6 rounded object-cover"
          />
        ) : (
          <Photo className="text-ui-fg-muted" />
        )}
        <span className="txt-compact-small text-ui-fg-subtle truncate">
          {hasMedia
            ? `${media.length} file${media.length > 1 ? "s" : ""}`
            : "Add photo"}
        </span>
      </button>
    </DataGridReadonlyCell>
  )
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export const InventoryBulkImport: React.FC = () => {
  const [tab, setTab] = useState<Tab>(Tab.GENERAL)
  const [tabState, setTabState] = useState<TabState>({
    [Tab.GENERAL]: "in-progress",
    [Tab.ITEMS]: "not-started",
  })
  const [mediaModalOpen, setMediaModalOpen] = useState(false)
  const [mediaRowIndex, setMediaRowIndex] = useState<number | null>(null)
  const [mediaInitialUrls, setMediaInitialUrls] = useState<string[]>([])
  const [importErrors, setImportErrors] = useState<
    { index: number; name: string; error: string }[]
  >([])

  const { handleSuccess } = useRouteModal()
  const { stock_locations = [] } = useStockLocations()
  const { mutateAsync: bulkImport, isPending } = useBulkImportInventory()
  const { categories: materialCategories = [], isLoading: categoriesLoading } =
    useRawMaterialCategories({})

  const form = useForm<BulkImportFormValues>({
    defaultValues: {
      stock_location_id: "",
      items: [{ ...EMPTY_ROW }, { ...EMPTY_ROW }, { ...EMPTY_ROW }],
    },
  })

  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: "items",
  })

  const items = form.watch("items")

  // ---- Tab state management -----------------------------------------------

  useEffect(() => {
    const state = { ...tabState }
    if (tab === Tab.GENERAL) {
      state[Tab.GENERAL] = "in-progress"
      state[Tab.ITEMS] = "not-started"
    }
    if (tab === Tab.ITEMS) {
      state[Tab.GENERAL] = "completed"
      state[Tab.ITEMS] = "in-progress"
    }
    setTabState(state)
  }, [tab])

  const handleNextTab = async () => {
    const valid = await form.trigger(["stock_location_id"])
    if (!valid) return
    setTab(Tab.ITEMS)
  }

  // ---- Row management -----------------------------------------------------

  const addRow = useCallback(() => {
    append({ ...EMPTY_ROW })
  }, [append])

  const removeRow = useCallback(
    (index: number) => {
      if (fields.length <= 1) return
      remove(index)
    },
    [fields.length, remove]
  )

  // ---- Media modal --------------------------------------------------------

  const openMediaForRow = useCallback(
    (index: number) => {
      // Snapshot the current row's media before opening so the modal
      // always starts with the correct selection, not a stale one.
      const currentMedia = form.getValues(`items.${index}.media`) || []
      setMediaRowIndex(index)
      setMediaInitialUrls([...currentMedia])
      setMediaModalOpen(true)
    },
    [form]
  )

  const handleMediaSave = useCallback(
    (urls: string[]) => {
      if (mediaRowIndex !== null) {
        form.setValue(`items.${mediaRowIndex}.media`, urls)
      }
      setMediaModalOpen(false)
      setMediaRowIndex(null)
    },
    [mediaRowIndex, form]
  )

  // ---- Category options for material type dropdown -------------------------

  const categoryOptions = useMemo(
    () =>
      materialCategories.map((cat) => ({
        label: cat.name,
        value: cat.name,
      })),
    [materialCategories]
  )

  // ---- DataGrid columns ---------------------------------------------------

  const columns: ColumnDef<BulkImportRow>[] = useMemo(() => {
    const cols: ColumnDef<BulkImportRow>[] = [
      columnHelper.column({
        id: "name",
        name: "Name",
        header: "Name",
        field: (context: any) => `items.${context.row.index}.name`,
        type: "text",
        cell: (context: any) => <DataGridTextCell context={context} />,
        disableHiding: true,
      }),
      columnHelper.column({
        id: "composition",
        name: "Composition",
        header: "Composition",
        field: (context: any) => `items.${context.row.index}.composition`,
        type: "text",
        cell: (context: any) => <DataGridTextCell context={context} />,
      }),
      columnHelper.column({
        id: "color",
        name: "Color",
        header: "Color",
        field: (context: any) => `items.${context.row.index}.color`,
        type: "text",
        cell: (context: any) => <DataGridTextCell context={context} />,
      }),
      columnHelper.column({
        id: "unit_of_measure",
        name: "Unit",
        header: "Unit",
        field: (context: any) =>
          `items.${context.row.index}.unit_of_measure`,
        type: "text",
        cell: (context: any) => (
          <DataGridSelectCell
            context={context}
            options={UNIT_OPTIONS}
            searchable
          />
        ),
      }),
      columnHelper.column({
        id: "material_type",
        name: "Material Type",
        header: "Material Type",
        field: (context: any) =>
          `items.${context.row.index}.material_type`,
        type: "text",
        cell: (context: any) => (
          <DataGridSelectCell
            context={context}
            options={categoryOptions}
            loading={categoriesLoading}
            searchable
            noResultsLabel="Type a name to create new"
          />
        ),
      }),
      columnHelper.column({
        id: "media",
        name: "Photo",
        header: "Photo",
        cell: (context: any) => (
          <MediaCell context={context} onOpenMedia={openMediaForRow} />
        ),
      }),
      columnHelper.column({
        id: "actions",
        name: "",
        header: "",
        cell: (context: any) => {
          const disabled = fields.length <= 1
          return (
            <div className="flex items-center justify-center h-full">
              <Tooltip content="Remove row" side="left">
                <IconButton
                  type="button"
                  size="small"
                  variant="transparent"
                  className="text-ui-fg-muted hover:text-ui-fg-base"
                  disabled={disabled}
                  onClick={() => removeRow(context.row.index)}
                >
                  <Trash />
                </IconButton>
              </Tooltip>
            </div>
          )
        },
      }),
    ]

    return cols.map((col) => {
      switch (col.id) {
        case "name":
          return { ...col, size: 220, maxSize: 350 }
        case "composition":
          return { ...col, size: 180, maxSize: 280 }
        case "color":
          return { ...col, size: 120, maxSize: 180 }
        case "unit_of_measure":
          return { ...col, size: 140, maxSize: 200 }
        case "material_type":
          return { ...col, size: 160, maxSize: 240 }
        case "media":
          return { ...col, size: 140, maxSize: 200 }
        case "actions":
          return { ...col, size: 60, maxSize: 80 }
        default:
          return col
      }
    })
  }, [fields.length, openMediaForRow, removeRow, categoryOptions, categoriesLoading])

  // ---- Submit -------------------------------------------------------------

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()

    const values = form.getValues()
    const validItems = values.items.filter((item) => item.name.trim())

    if (!validItems.length) {
      toast.error("Add at least one item with a name")
      return
    }

    setImportErrors([])

    try {
      const result = await bulkImport({
        items: validItems.map((item) => ({
          name: item.name.trim(),
          composition: item.composition?.trim() || undefined,
          color: item.color?.trim() || undefined,
          unit_of_measure: (item.unit_of_measure as any) || "Other",
          media: item.media?.length ? item.media : undefined,
          material_type: item.material_type?.trim() || undefined,
        })),
        stock_location_id: values.stock_location_id || undefined,
      })

      if (result.errors?.length) {
        setImportErrors(result.errors)
        toast.warning(
          `Created ${result.created?.length || 0} items. ${result.errors.length} failed.`
        )
      } else {
        toast.success(result.message || "Inventory imported successfully")
        handleSuccess()
      }
    } catch (e: any) {
      toast.error(e?.message || "Failed to import inventory")
    }
  }

  // ---- Grid keyboard shortcut: Enter on last row adds new row -------------

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== "Enter") return

    // Don't add a row when Cmd/Ctrl+Enter (that's form submit)
    if (e.metaKey || e.ctrlKey) return

    const activeElement = document.activeElement
    if (!activeElement) return

    // Only trigger on actual text inputs — not select triggers,
    // dropdown items, or buttons which use Enter for their own action
    const isTextInput =
      activeElement.tagName === "INPUT" &&
      (activeElement as HTMLInputElement).type !== "button"

    if (!isTextInput) return

    // Check if a select dropdown is currently open anywhere
    const openDropdown = document.querySelector(
      '[data-state="open"][role="listbox"], [data-state="open"][data-radix-select-content]'
    )
    if (openDropdown) return

    const gridContainer = activeElement.closest('[role="grid"]')
    if (!gridContainer) return

    const rows = gridContainer.querySelectorAll(
      '[role="row"]:not(:first-child)'
    )
    if (rows.length === 0) return

    const lastRow = rows[rows.length - 1]
    if (lastRow && lastRow.contains(activeElement)) {
      addRow()
      e.preventDefault()
    }
  }

  const filledCount = items.filter((i) => i.name?.trim()).length

  // ---- Render -------------------------------------------------------------

  return (
    <RouteFocusModal.Form form={form}>
      <KeyboundForm
        onSubmit={handleSubmit}
        className="flex h-full flex-col overflow-hidden"
      >
        <ProgressTabs
          value={tab}
          onValueChange={async (value) => {
            if (tab === Tab.GENERAL && value === Tab.ITEMS) {
              const valid = await form.trigger(["stock_location_id"])
              if (!valid) return
            }
            setTab(value as Tab)
          }}
          className="flex h-full flex-col overflow-hidden"
        >
          <RouteFocusModal.Header>
            <div className="-my-2 w-full border-l">
              <ProgressTabs.List className="flex w-full items-center justify-start">
                <ProgressTabs.Trigger
                  value={Tab.GENERAL}
                  status={tabState[Tab.GENERAL]}
                  className="w-full max-w-[200px]"
                >
                  General
                </ProgressTabs.Trigger>
                <ProgressTabs.Trigger
                  value={Tab.ITEMS}
                  status={tabState[Tab.ITEMS]}
                  className="w-full max-w-[200px]"
                >
                  Items
                </ProgressTabs.Trigger>
              </ProgressTabs.List>
            </div>
          </RouteFocusModal.Header>

          <RouteFocusModal.Body className="size-full overflow-hidden">
            {/* ============ Step 1: General ============ */}
            <ProgressTabs.Content
              value={Tab.GENERAL}
              className="size-full overflow-y-auto data-[state=inactive]:hidden"
            >
              <div className="flex flex-col gap-y-6 p-8">
                <Heading className="text-xl md:text-2xl">
                  Import Inventory
                </Heading>
                <Text size="small" className="text-ui-fg-subtle">
                  Select the stock location where imported items will be
                  assigned, then continue to add items.
                </Text>

                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <Form.Field
                    control={form.control}
                    name="stock_location_id"
                    render={({ field }) => (
                      <Form.Item>
                        <Form.Label>Stock Location</Form.Label>
                        <Form.Control>
                          <Select
                            value={field.value}
                            onValueChange={field.onChange}
                          >
                            <Select.Trigger>
                              <Select.Value placeholder="Select stock location" />
                            </Select.Trigger>
                            <Select.Content>
                              {stock_locations.map((loc) => (
                                <Select.Item key={loc.id} value={loc.id}>
                                  {loc.name}
                                </Select.Item>
                              ))}
                            </Select.Content>
                          </Select>
                        </Form.Control>
                        <Form.Hint>
                          All imported items will have inventory levels
                          created at this location.
                        </Form.Hint>
                        <Form.ErrorMessage />
                      </Form.Item>
                    )}
                  />
                </div>
              </div>
            </ProgressTabs.Content>

            {/* ============ Step 2: Items ============ */}
            <ProgressTabs.Content
              value={Tab.ITEMS}
              className="flex flex-col h-full data-[state=inactive]:hidden"
            >
              <div className="flex-1 overflow-hidden flex flex-col">
                <div className="flex-1 overflow-y-auto p-8">
                  <div className="mb-6">
                    <div className="flex items-center justify-between mb-2">
                      <Heading className="text-xl">
                        Items ({fields.length})
                      </Heading>
                      <Button
                        size="small"
                        variant="secondary"
                        type="button"
                        onClick={addRow}
                        disabled={isPending}
                      >
                        <Plus />
                        Add Row
                      </Button>
                    </div>
                    <Text size="small" className="text-ui-fg-subtle">
                      Fill in the inventory items to import. Click the
                      photo cell to attach media from the media library.
                    </Text>
                  </div>

                  <div className="flex-1 min-h-0" onKeyDown={handleKeyDown}>
                    <DataGrid
                      data={items}
                      columns={columns}
                      state={form}
                      onRemoveRow={removeRow}
                      disableInteractions={isPending}
                    />
                  </div>

                  <Text size="xsmall" className="text-ui-fg-muted mt-2">
                    Press Enter in the last row to add a new one. Press
                    Cmd/Ctrl+Enter to import.
                  </Text>

                  {/* Error details for partial failures */}
                  {importErrors.length > 0 && (
                    <div className="mt-4 rounded border border-ui-border-error bg-ui-bg-subtle-hover p-3">
                      <Text className="font-medium text-ui-fg-error mb-2">
                        Failed items:
                      </Text>
                      <ul className="list-disc pl-5 space-y-1">
                        {importErrors.map((err) => (
                          <li key={err.index}>
                            <Text size="small" className="text-ui-fg-error">
                              <span className="font-medium">
                                {err.name}
                              </span>
                              : {err.error}
                            </Text>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              </div>
            </ProgressTabs.Content>
          </RouteFocusModal.Body>

          <RouteFocusModal.Footer>
            <div className="flex w-full items-center justify-between">
              <div className="flex items-center gap-x-2">
                {tab === Tab.ITEMS && (
                  <Button
                    variant="secondary"
                    size="small"
                    type="button"
                    onClick={() => setTab(Tab.GENERAL)}
                    disabled={isPending}
                  >
                    Back
                  </Button>
                )}
              </div>
              <div className="flex items-center gap-x-2">
                <RouteFocusModal.Close asChild>
                  <Button
                    variant="secondary"
                    size="small"
                    type="button"
                    disabled={isPending}
                  >
                    Cancel
                  </Button>
                </RouteFocusModal.Close>
                {tab === Tab.GENERAL && (
                  <Button
                    variant="primary"
                    size="small"
                    type="button"
                    onClick={handleNextTab}
                  >
                    Continue
                  </Button>
                )}
                {tab === Tab.ITEMS && (
                  <Button
                    variant="primary"
                    size="small"
                    type="submit"
                    isLoading={isPending}
                    disabled={isPending || filledCount === 0}
                  >
                    Import {filledCount} Item
                    {filledCount !== 1 ? "s" : ""}
                  </Button>
                )}
              </div>
            </div>
          </RouteFocusModal.Footer>
        </ProgressTabs>
      </KeyboundForm>

      {/* Media Modal */}
      <ProductMediaModal
        open={mediaModalOpen}
        onOpenChange={setMediaModalOpen}
        initialUrls={mediaInitialUrls}
        onSave={handleMediaSave}
      />
    </RouteFocusModal.Form>
  )
}
