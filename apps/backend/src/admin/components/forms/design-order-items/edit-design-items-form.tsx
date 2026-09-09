import { useCallback, useMemo, useState } from "react"
import {
  Badge,
  Checkbox,
  CommandBar,
  DataTable,
  DataTableFilteringState,
  DataTablePaginationState,
  Heading,
  StatusBadge,
  Text,
  createDataTableColumnHelper,
  createDataTableFilterHelper,
  toast,
  usePrompt,
  useDataTable,
} from "@medusajs/ui"

import { RouteFocusModal } from "../../modal/route-focus-modal"
import { StackedFocusModal } from "../../modal/stacked-modal/stacked-focused-modal"
import { useStackedModal } from "../../modal/stacked-modal/use-stacked-modal"
import {
  useDesignOrder,
  useChangeOrderItemDesign,
  type OrderItemRow,
} from "../../../hooks/api/design-orders"
import { useDesigns, type AdminDesign } from "../../../hooks/api/designs"

/**
 * #1918 — "Edit Items" on a design order: change or detach the design behind
 * each ordered line.
 *
 * Mirrors the shape of Medusa's own `/orders/:id/edits` — a focus modal over
 * the order, its lines in a table, actions in a CommandBar — but edits the
 * DESIGN binding, not the commerce.
 *
 * 🔴 It does NOT touch the order. Title, price, quantity and totals are left
 * exactly as they are and no order edit is created; only which design a line
 * stands for changes. Repricing a captured order is a separate, manual step
 * taken once the designs are finished, through Medusa's order-edit flow.
 */

const PICKER_ID = "pick-design"

const itemColumns = createDataTableColumnHelper<OrderItemRow>()
const designColumns = createDataTableColumnHelper<AdminDesign>()
const filterHelper = createDataTableFilterHelper<AdminDesign>()

const STATE_COLOR: Record<
  OrderItemRow["state"],
  "green" | "blue" | "orange" | "grey"
> = {
  delivered: "green",
  shipped: "blue",
  made: "orange",
  outstanding: "grey",
}

const Thumb = ({ src }: { src?: string | null }) =>
  src ? (
    <img src={src} alt="" className="size-10 shrink-0 rounded object-cover" />
  ) : (
    <div className="bg-ui-bg-component size-10 shrink-0 rounded" />
  )

/**
 * The design picker, one stacked layer above the item list.
 *
 * Opened programmatically from the CommandBar rather than by a `Trigger`: a
 * `StackedFocusModal.Trigger` rendered OUTSIDE its own root closes the modal
 * underneath instead of opening this one, and a CommandBar action cannot live
 * inside the root without putting the whole bar in there.
 */
const DesignPickerModal = ({
  target,
  onReplace,
  isPending,
}: {
  target: OrderItemRow | null
  onReplace: (designId: string) => void
  isPending: boolean
}) => {
  const [search, setSearch] = useState("")
  const [selected, setSelected] = useState<string | null>(null)
  const [pagination, setPagination] = useState<DataTablePaginationState>({
    pageIndex: 0,
    pageSize: 10,
  })
  const [filtering, setFiltering] = useState<DataTableFilteringState>({})

  const serverFilters = useMemo(() => {
    const out: Record<string, any> = {}
    for (const [k, v] of Object.entries(filtering)) {
      if (v !== undefined && v !== null && v !== "") {
        out[k] = v
      }
    }
    return out
  }, [filtering])

  const { designs, count = 0, isLoading } = useDesigns({
    limit: pagination.pageSize,
    offset: pagination.pageIndex * pagination.pageSize,
    q: search || undefined,
    ...serverFilters,
  })

  // Single-select: picking a row REPLACES the selection. The action is
  // "replace this line's design with that one", which has exactly one answer.
  const pick = useCallback((id: string) => {
    setSelected((prev) => (prev === id ? null : id))
  }, [])

  const columns = useMemo(
    () => [
      designColumns.display({
        id: "select",
        header: "",
        cell: ({ row }) => (
          /*
            🔴 stopPropagation is load-bearing. The table also has onRowClick,
            so a click on the checkbox toggles ONCE via onCheckedChange and
            again as it bubbles to the row — the two cancel and the box never
            appears to tick. Nothing errors; selection is simply impossible.
          */
          <div onClick={(e) => e.stopPropagation()}>
            <Checkbox
              checked={selected === row.original.id}
              onCheckedChange={() => pick(row.original.id)}
            />
          </div>
        ),
      }),
      designColumns.accessor("name", {
        header: "Design",
        cell: ({ row }) => (
          <div className="flex items-center gap-x-3">
            <Thumb src={(row.original as any).thumbnail_url} />
            <Text size="small" className="truncate">
              {row.original.name}
            </Text>
          </div>
        ),
      }),
      designColumns.accessor("status", {
        header: "Status",
        cell: ({ row }) => (
          <Badge size="2xsmall">
            {String(row.original.status ?? "").replace(/_/g, " ")}
          </Badge>
        ),
      }),
      designColumns.accessor("design_type", { header: "Type" }),
      designColumns.accessor("priority", { header: "Priority" }),
    ],
    [selected, pick]
  )

  const filters = useMemo(
    () => [
      filterHelper.accessor("status", {
        type: "select",
        label: "Status",
        options: [
          "Conceptual",
          "In_Development",
          "Technical_Review",
          "Sample_Production",
          "Approved",
          "Commerce_Ready",
          "Rejected",
          "On_Hold",
        ].map((v) => ({ label: v.replace(/_/g, " "), value: v })),
      }),
      filterHelper.accessor("design_type", {
        type: "select",
        label: "Type",
        options: [
          { label: "Original", value: "Original" },
          { label: "Derivative", value: "Derivative" },
          { label: "Custom", value: "Custom" },
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
    ],
    []
  )

  const table = useDataTable({
    columns,
    data: designs ?? [],
    getRowId: (row) => row.id,
    rowCount: count,
    onRowClick: (_, row) => pick(row.id),
    isLoading,
    filters,
    pagination: { state: pagination, onPaginationChange: setPagination },
    search: { state: search, onSearchChange: setSearch },
    filtering: {
      state: filtering,
      onFilteringChange: (next) => {
        setFiltering(next)
        // A filter that keeps you on page 4 of a 1-page result shows nothing.
        setPagination((prev) => ({ ...prev, pageIndex: 0 }))
      },
    },
  })

  return (
    <StackedFocusModal id={PICKER_ID}>
      <StackedFocusModal.Content>
        <StackedFocusModal.Header>
          <Heading level="h2">Pick a design</Heading>
        </StackedFocusModal.Header>
        <StackedFocusModal.Body className="flex flex-col overflow-hidden p-0">
          <DataTable instance={table}>
            <DataTable.Toolbar className="flex items-start justify-between px-6 py-4">
              <div>
                <Heading level="h2">Replace the design</Heading>
                <Text size="small" className="text-ui-fg-subtle">
                  {target
                    ? `For “${target.title ?? target.id}”. This re-points the line; it does not change what the customer is charged.`
                    : ""}
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
        </StackedFocusModal.Body>
      </StackedFocusModal.Content>

      <CommandBar open={Boolean(selected)}>
        <CommandBar.Bar>
          <CommandBar.Value>1 design selected</CommandBar.Value>
          <CommandBar.Command
            action={() => {
              if (selected) {
                onReplace(selected)
                setSelected(null)
              }
            }}
            label={isPending ? "Replacing…" : "Replace"}
            shortcut="r"
            disabled={isPending}
          />
        </CommandBar.Bar>
      </CommandBar>
    </StackedFocusModal>
  )
}

export const EditDesignItemsForm = ({
  pageLineItemId,
}: {
  pageLineItemId: string
}) => {
  const prompt = usePrompt()
  const { setIsOpen } = useStackedModal()
  const { designOrder, isLoading } = useDesignOrder(pageLineItemId)
  const { mutateAsync, isPending } = useChangeOrderItemDesign(pageLineItemId)
  const [selectedItem, setSelectedItem] = useState<string | null>(null)

  const rows: OrderItemRow[] = designOrder?.order_items?.items ?? []
  const target = useMemo(
    () => rows.find((r) => r.id === selectedItem) ?? null,
    [rows, selectedItem]
  )

  const pickItem = useCallback((id: string) => {
    // One line at a time: both actions read "this line's design", which has no
    // meaning across a multi-selection.
    setSelectedItem((prev) => (prev === id ? null : id))
  }, [])

  const change = async (
    row: OrderItemRow,
    designId: string | null,
    verb: "Replace" | "Detach"
  ) => {
    /**
     * Preview first, so the confirm dialog can quote the sentence the customer
     * will actually receive. The wording depends on whether the garment has a
     * production run, and an admin deserves to see it before it is sent.
     */
    let headline = ""
    try {
      const preview: any = await mutateAsync({
        order_line_item_id: row.id,
        design_id: designId,
        dry_run: true,
      })
      headline = preview?.notice?.headline ?? ""
    } catch {
      // A failed preview costs context in the dialog, not the operation.
    }

    const confirmed = await prompt({
      title: `${verb} design`,
      description: [
        `${verb} the design on “${row.title ?? row.id}”.`,
        row.state === "delivered"
          ? "⚠️ This line has already been DELIVERED — changing its design does not change what the customer received."
          : "",
        "The order itself is not changed: price, quantity and totals stay as they are.",
        headline ? `The customer will be told: “${headline}”` : "",
      ]
        .filter(Boolean)
        .join("\n\n"),
      confirmText: verb,
      cancelText: "Cancel",
    })
    if (!confirmed) {
      return
    }

    try {
      await mutateAsync({ order_line_item_id: row.id, design_id: designId })
      setSelectedItem(null)
      toast.success(`Design ${verb.toLowerCase()}d. The customer has been told.`)
    } catch (e: any) {
      toast.error(e?.message ?? `Could not ${verb.toLowerCase()} the design`)
    }
  }

  const columns = useMemo(
    () => [
      itemColumns.display({
        id: "select",
        header: "",
        cell: ({ row }) => (
          // See the picker's select column: without stopPropagation the row's
          // onRowClick undoes the checkbox's own toggle.
          <div onClick={(e) => e.stopPropagation()}>
            <Checkbox
              checked={selectedItem === row.original.id}
              onCheckedChange={() => pickItem(row.original.id)}
            />
          </div>
        ),
      }),
      itemColumns.accessor("title", {
        header: "Item",
        cell: ({ row }) => (
          <div className="flex items-center gap-x-3">
            <Thumb src={row.original.thumbnail} />
            <div className="min-w-0">
              <Text size="small" weight="plus" className="truncate">
                {row.original.title ?? row.original.id}
              </Text>
              <Text size="xsmall" className="text-ui-fg-subtle">
                {row.original.ordered ?? 0} ordered
              </Text>
            </div>
          </div>
        ),
      }),
      itemColumns.accessor("design", {
        header: "Design",
        cell: ({ row }) =>
          row.original.design ? (
            <div className="flex flex-col">
              <Text size="small" className="truncate">
                {row.original.design.name ?? row.original.design.id}
              </Text>
              {/* Only worth saying when it disagrees with what was ordered. */}
              {row.original.original_design_id &&
              row.original.original_design_id !== row.original.design.id ? (
                <Text size="xsmall" className="text-ui-fg-muted">
                  ordered as {row.original.original_design_id}
                </Text>
              ) : null}
            </div>
          ) : (
            <Badge size="2xsmall" color="grey">
              None
            </Badge>
          ),
      }),
      itemColumns.accessor("state", {
        header: "Status",
        cell: ({ row }) => (
          <StatusBadge color={STATE_COLOR[row.original.state]}>
            {row.original.state_label}
          </StatusBadge>
        ),
      }),
    ],
    [selectedItem, pickItem]
  )

  const table = useDataTable({
    data: rows,
    columns,
    getRowId: (row) => row.id,
    rowCount: rows.length,
    onRowClick: (_, row) => pickItem(row.id),
    isLoading,
  })

  return (
    <>
      <RouteFocusModal.Header>
        <Heading level="h1">Edit items</Heading>
      </RouteFocusModal.Header>
      <RouteFocusModal.Body className="flex flex-col overflow-hidden p-0">
        {!rows.length && !isLoading ? (
          <div className="p-6">
            <Text size="small" className="text-ui-fg-subtle">
              This commission has no ordered lines yet. Designs can only be
              re-pointed once the order exists — before checkout the binding is
              a cart-level link that does not survive payment.
            </Text>
          </div>
        ) : (
          <DataTable instance={table}>
            <DataTable.Toolbar className="flex items-start justify-between px-6 py-4">
              <div>
                <Heading level="h2">Designs on this order</Heading>
                <Text size="small" className="text-ui-fg-subtle">
                  Select a line, then Change or Detach. This re-points the line
                  only — prices, quantities and totals are untouched; update
                  those separately once the designs are finished.
                </Text>
              </div>
            </DataTable.Toolbar>
            <DataTable.Table />
          </DataTable>
        )}
      </RouteFocusModal.Body>

      <CommandBar open={Boolean(target)}>
        <CommandBar.Bar>
          <CommandBar.Value>1 item selected</CommandBar.Value>
          <CommandBar.Command
            action={() => setIsOpen(PICKER_ID, true)}
            label={target?.design ? "Change design" : "Attach design"}
            shortcut="c"
            disabled={isPending}
          />
          {target?.design ? (
            <CommandBar.Command
              action={() => target && change(target, null, "Detach")}
              label="Detach design"
              shortcut="d"
              disabled={isPending}
            />
          ) : null}
        </CommandBar.Bar>
      </CommandBar>

      <DesignPickerModal
        target={target}
        isPending={isPending}
        onReplace={(designId) => {
          setIsOpen(PICKER_ID, false)
          if (target) {
            void change(target, designId, "Replace")
          }
        }}
      />
    </>
  )
}
