import { useCallback, useMemo, useState } from "react"
import {
  Badge,
  Button,
  Checkbox,
  CommandBar,
  DataTable,
  DataTableFilteringState,
  DataTablePaginationState,
  Heading,
  Label,
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
  useChangeOrderDesigns,
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
  onReplace: (designId: string, designName: string | null) => void
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
                const picked = (designs ?? []).find(
                  (d: AdminDesign) => d.id === selected
                )
                onReplace(selected, picked?.name ?? null)
                setSelected(null)
              }
            }}
            label={isPending ? "Staging…" : "Replace"}
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
  const { mutateAsync, isPending } = useChangeOrderDesigns(pageLineItemId)
  const [selectedItem, setSelectedItem] = useState<string | null>(null)
  /**
   * Staged, not applied. Line item id -> the design it will point at (null
   * detaches).
   *
   * 🔴 This is the whole point of the rewrite. Applying each line as it was
   * picked sent the customer one email PER LINE — three re-points, three
   * emails, each describing a third of one decision. Medusa's own order edit
   * stages actions on a single change and notifies once when it is applied;
   * this now does the same.
   */
  const [staged, setStaged] = useState<Record<string, string | null>>({})
  /**
   * design id -> name, for the designs picked in THIS session. The staged row
   * has to be readable before it is applied, and the picked design is not on
   * the order yet so no server row carries its name.
   */
  const [stagedNames, setStagedNames] = useState<Record<string, string>>({})
  /**
   * #1953 — commission production for the lines this change moves.
   *
   * The API has accepted `production: { mode: "new" }` since #1955; nothing in
   * the admin asked the question, so the only way to answer it was to call the
   * route by hand. Off by default, matching the route's own default: making
   * work is not a side effect of re-pointing a design.
   *
   * Request-level rather than per-line because that is the API's shape — "new"
   * commissions one run per line the change actually MOVED. A detached line or
   * a line that did not move gets none, and says why.
   */
  const [commissionRuns, setCommissionRuns] = useState(false)

  const orderId: string | null = designOrder?.order?.id ?? null
  const rows: OrderItemRow[] = designOrder?.order_items?.items ?? []
  const target = useMemo(
    () => rows.find((r) => r.id === selectedItem) ?? null,
    [rows, selectedItem]
  )

  const stagedEntries = useMemo(
    () =>
      Object.entries(staged).map(([line_item_id, design_id]) => ({
        line_item_id,
        design_id,
      })),
    [staged]
  )

  const pickItem = useCallback((id: string) => {
    // One line at a time: both actions read "this line's design", which has no
    // meaning across a multi-selection.
    setSelectedItem((prev) => (prev === id ? null : id))
  }, [])

  /** Stage one line's move. Nothing is written and nobody is emailed yet. */
  const stage = (
    row: OrderItemRow,
    designId: string | null,
    designName?: string | null
  ) => {
    if (designId && designName) {
      setStagedNames((prev) => ({ ...prev, [designId]: designName }))
    }
    setStaged((prev) => {
      const next = { ...prev }
      /**
       * Staging a line back onto the design it already has is not a change —
       * it is an undo. Keeping it would send the customer a line saying a
       * design changed to itself.
       */
      if ((row.design?.id ?? null) === designId) {
        delete next[row.id]
      } else {
        next[row.id] = designId
      }
      return next
    })
    setSelectedItem(null)
  }

  const unstage = (lineItemId: string) => {
    setStaged((prev) => {
      const next = { ...prev }
      delete next[lineItemId]
      return next
    })
  }

  /** Apply every staged move as ONE change, with ONE email. */
  const apply = async () => {
    if (!orderId || !stagedEntries.length) {
      return
    }

    /**
     * Preview first, so the confirm dialog can quote the sentence the customer
     * will actually receive — now one sentence about the whole change, which
     * is the sentence that will actually be sent.
     */
    let headline = ""
    try {
      const preview: any = await mutateAsync({
        order_id: orderId,
        changes: stagedEntries,
        production: { mode: commissionRuns ? "new" : "none" },
        dry_run: true,
      })
      headline = preview?.notice?.headline ?? ""
    } catch {
      // A failed preview costs context in the dialog, not the operation.
    }

    const deliveredCount = stagedEntries.filter(
      (c) => rows.find((r) => r.id === c.line_item_id)?.state === "delivered"
    ).length

    const confirmed = await prompt({
      title:
        stagedEntries.length === 1
          ? "Apply 1 design change"
          : `Apply ${stagedEntries.length} design changes`,
      description: [
        stagedEntries.length === 1
          ? "One line will be re-pointed."
          : `${stagedEntries.length} lines will be re-pointed, and the customer gets ONE email about all of them.`,
        deliveredCount
          ? `⚠️ ${deliveredCount} of these ${deliveredCount === 1 ? "lines has" : "lines have"} already been DELIVERED — changing the design does not change what the customer received.`
          : "",
        "The order itself is not changed: price, quantity and totals stay as they are.",
        /**
         * Commissioning work is the one part of this dialog that is not
         * reversible by re-pointing the line again, so it is stated plainly
         * rather than left to the checkbox the operator ticked a moment ago.
         * The preview cannot enumerate which lines get a run — a dry run
         * returns `production_skipped_reason: "dry run"` for every line — so
         * this says what WILL happen, not what did.
         */
        commissionRuns
          ? `🏭 A production run will be commissioned for each line this change actually moves${deliveredCount ? ", which does not include lines that did not move" : ""}. Lines that already have an active run are skipped. Cancelling a run afterwards is a separate step.`
          : "",
        headline ? `The customer will be told: “${headline}”` : "",
      ]
        .filter(Boolean)
        .join("\n\n"),
      confirmText: "Apply",
      cancelText: "Cancel",
    })
    if (!confirmed) {
      return
    }

    try {
      const res: any = await mutateAsync({
        order_id: orderId,
        changes: stagedEntries,
        production: { mode: commissionRuns ? "new" : "none" },
      })
      setStaged({})
      setSelectedItem(null)
      setCommissionRuns(false)

      const lines =
        stagedEntries.length === 1 ? "1 line" : `${stagedEntries.length} lines`
      const emailPart = res?.email?.sent
        ? "The customer has been told, once."
        : `No email was sent: ${res?.email?.reason ?? "unknown reason"}.`

      /**
       * Report what production actually did, per line, from the response —
       * never from the fact that we asked. A run can be skipped for reasons
       * only the server knows (the line did not move, it already has a run,
       * creation failed), and each arrives as `production_skipped_reason`.
       * Claiming "runs commissioned" because the box was ticked would be a
       * confident nothing.
       */
      const items: any[] = Array.isArray(res?.items) ? res.items : []
      const made = items.filter((i) => i?.production_run_id).length
      const skipped = items.filter(
        (i) => !i?.production_run_id && i?.production_skipped_reason
      )
      let runPart = ""
      if (commissionRuns) {
        runPart =
          made > 0
            ? ` ${made === 1 ? "1 run" : `${made} runs`} commissioned.`
            : " No run was commissioned."
        if (skipped.length) {
          // The first reason verbatim: with a handful of lines it is the whole
          // story, and a count alone sends the operator to the network tab.
          runPart += ` ${skipped.length} skipped (${skipped[0].production_skipped_reason}).`
        }
      }

      if (commissionRuns && made === 0) {
        toast.warning(`${lines} re-pointed.${runPart} ${emailPart}`)
      } else {
        toast.success(`${lines} re-pointed.${runPart} ${emailPart}`)
      }
    } catch (e: any) {
      toast.error(e?.message ?? "Could not apply the design changes")
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
        cell: ({ row }) => {
          /*
            A staged move is shown where the design is, marked as pending. The
            row must not read as already changed — nothing has been written and
            the customer has not been told until Apply.
          */
          const isStaged = Object.prototype.hasOwnProperty.call(
            staged,
            row.original.id
          )
          const stagedId = isStaged ? staged[row.original.id] : undefined
          const stagedName = stagedId
            ? (stagedNames[stagedId] ?? stagedId)
            : null

          if (isStaged) {
            return (
              <div className="flex flex-col gap-y-1">
                <div className="flex items-center gap-x-2">
                  <Text size="small" className="truncate">
                    {stagedId ? stagedName : "None"}
                  </Text>
                  <Badge size="2xsmall" color="orange">
                    Pending
                  </Badge>
                </div>
                <Text size="xsmall" className="text-ui-fg-muted truncate">
                  now:{" "}
                  {row.original.design
                    ? (row.original.design.name ?? row.original.design.id)
                    : "None"}
                </Text>
              </div>
            )
          }

          return row.original.design ? (
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
          )
        },
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
    [selectedItem, pickItem, staged, stagedNames]
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
                  Select a line, then Change or Detach. Nothing is sent until
                  you Apply — every change goes together, and the customer gets
                  one email about all of them. This re-points the lines only:
                  prices, quantities and totals are untouched.
                </Text>
              </div>
            </DataTable.Toolbar>
            <DataTable.Table />
          </DataTable>
        )}
      </RouteFocusModal.Body>

      {/*
        The footer is the only door that writes. Staged moves are visible in
        the table and reversible until this is pressed — which is what makes
        one email about the whole change possible.
      */}
      <RouteFocusModal.Footer>
        <div className="flex w-full items-center justify-end gap-x-3">
          {stagedEntries.length > 0 ? (
            <Text size="small" className="text-ui-fg-subtle mr-auto">
              {stagedEntries.length === 1
                ? "1 change staged — the customer will get one email."
                : `${stagedEntries.length} changes staged — the customer will get one email.`}
            </Text>
          ) : null}
          {/**
            * #1953 — the question the API has been able to answer since #1955
            * and nothing in the admin asked. Only shown once something is
            * staged: with nothing to move there are no lines to commission work
            * for, and an always-visible toggle would imply otherwise.
            */}
          {stagedEntries.length > 0 ? (
            <div className="flex items-center gap-x-2">
              <Checkbox
                id="commission-runs"
                checked={commissionRuns}
                onCheckedChange={(value) => setCommissionRuns(Boolean(value))}
                disabled={isPending}
              />
              <Label
                htmlFor="commission-runs"
                size="small"
                weight="plus"
                className="cursor-pointer"
              >
                Commission production
              </Label>
            </div>
          ) : null}
          <Button
            size="small"
            variant="secondary"
            disabled={!stagedEntries.length || isPending}
            onClick={() => {
              setStaged({})
              setSelectedItem(null)
              // The toggle belongs to the staged batch, not to the modal.
              setCommissionRuns(false)
            }}
          >
            Discard
          </Button>
          <Button
            size="small"
            disabled={!stagedEntries.length || !orderId || isPending}
            onClick={() => void apply()}
          >
            {isPending
              ? "Applying…"
              : stagedEntries.length > 1
                ? `Apply ${stagedEntries.length} changes`
                : "Apply"}
          </Button>
        </div>
      </RouteFocusModal.Footer>

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
              action={() => target && stage(target, null)}
              label="Detach design"
              shortcut="d"
              disabled={isPending}
            />
          ) : null}
          {target &&
          Object.prototype.hasOwnProperty.call(staged, target.id) ? (
            <CommandBar.Command
              action={() => target && unstage(target.id)}
              label="Undo staged"
              shortcut="u"
              disabled={isPending}
            />
          ) : null}
        </CommandBar.Bar>
      </CommandBar>

      <DesignPickerModal
        target={target}
        isPending={isPending}
        onReplace={(designId, designName) => {
          setIsOpen(PICKER_ID, false)
          if (target) {
            stage(target, designId, designName)
          }
        }}
      />
    </>
  )
}
