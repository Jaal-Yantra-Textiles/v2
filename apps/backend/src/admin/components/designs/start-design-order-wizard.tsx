import {
  Badge,
  Button,
  CommandBar,
  DataTable,
  Heading,
  ProgressStatus,
  ProgressTabs,
  Text,
  createDataTableColumnHelper,
  toast,
  useDataTable,
  type DataTablePaginationState,
  type DataTableRowSelectionState,
} from "@medusajs/ui"
import { keepPreviousData } from "@tanstack/react-query"
import { useMemo, useState } from "react"

import { RouteFocusModal } from "../modal/route-focus-modal"
import { useRouteModal } from "../modal/use-route-modal"
import { sdk } from "../../lib/config"
import { useDesigns } from "../../hooks/api/designs"
import {
  designOrderCreateBody,
  designOrderRoutes,
  resolveDesignOrderTarget,
  type DesignForOrder,
} from "./design-order-draft"

/**
 * Start a design order — as a stepped RouteFocusModal.
 *
 * What this replaces: a plain `FocusModal` holding a hand-rolled checkbox list
 * with its own search box and its own "load more". That list could not sort,
 * filter, or tell you how many designs it was choosing from, and it was a
 * second implementation of a table this admin already has.
 *
 * Now it is the platform's `DataTable` — table view, pagination, global search
 * — with row selection surfaced through the `CommandBar`, the same shape the
 * Designs list itself uses. Nothing about the BACKEND changes: it still calls
 * `/admin/designs/draft-order{,/preview}` (or the customer twins) and still
 * takes the who-is-this-for rule from `design-order-draft`, so an order started
 * here and one started from the designs page remain the same object priced the
 * same way.
 *
 * 🔑 Two steps, not three. The buyer is DERIVED from the chosen designs
 * (`resolveDesignOrderTarget`) rather than picked — a design carries a customer
 * only when it was made for somebody, and a cart on the WRONG buyer is worse
 * than a cart on none. A design order with no buyer is ordinary (#1817); one
 * is attached later on the detail page. Offering a buyer picker here would
 * invite exactly the wrong-buyer mistake the rule exists to prevent.
 */

enum Step {
  DESIGNS = "designs",
  REVIEW = "review",
}

type EstimateRow = {
  design_id: string
  name?: string | null
  /** null when the design cannot be priced — NOT zero. See the grid below. */
  total_estimated?: number | null
  unit_price?: number | null
  confidence?: string | null
  material_cost?: number | null
  production_cost?: number | null
}

type PreviewResponse = {
  estimates: EstimateRow[]
  currency_code: string
  total: number
  /** Designs the estimator could not price at all. */
  unpriceable?: Array<{ design_id?: string; name?: string; reason?: string }> | string[]
  /** False when `total` omits something — the total is then a PARTIAL sum. */
  total_is_complete?: boolean
}

/**
 * 10, matching every other picker table in this admin (link-design,
 * send-to-partner, link-design-partner). A page that does not fit the modal
 * is worse than a shorter one: the rows below the fold are invisible and the
 * pagination sits under a list that looks complete.
 */
const PAGE_SIZE = 10
const columnHelper = createDataTableColumnHelper<any>()
const estimateHelper = createDataTableColumnHelper<EstimateRow>()

const money = (amount: number, currency: string) => {
  const n = Number(amount)
  if (!Number.isFinite(n)) return "—"
  try {
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: (currency || "inr").toUpperCase(),
      minimumFractionDigits: 2,
    }).format(n)
  } catch {
    return `${n} ${(currency || "").toUpperCase()}`
  }
}

/** A money cell that says "—" for absent rather than printing a zero. */
const Money = ({ value, currency }: { value?: number | null; currency: string }) => (
  <Text size="small" leading="compact" className="text-ui-fg-subtle">
    {value == null || !Number.isFinite(Number(value)) ? "—" : money(Number(value), currency)}
  </Text>
)

export const StartDesignOrderWizard = () => {
  const { handleSuccess } = useRouteModal()

  const [step, setStep] = useState<Step>(Step.DESIGNS)
  const [search, setSearch] = useState("")
  const [pagination, setPagination] = useState<DataTablePaginationState>({
    pageIndex: 0,
    pageSize: PAGE_SIZE,
  })
  const [rowSelection, setRowSelection] = useState<DataTableRowSelectionState>({})

  const [isPreviewing, setIsPreviewing] = useState(false)
  const [isCreating, setIsCreating] = useState(false)
  const [preview, setPreview] = useState<PreviewResponse | null>(null)
  /**
   * Frozen at preview time. The basket stays editable behind the review step,
   * so what the create button posts must be what was actually estimated —
   * otherwise an operator prices one selection and creates another.
   */
  const [target, setTarget] = useState<{
    customer_id: string | null
    design_ids: string[]
  } | null>(null)

  const { designs, count, isLoading } = useDesigns(
    {
      limit: pagination.pageSize,
      offset: pagination.pageIndex * pagination.pageSize,
      ...(search ? { q: search } : {}),
    } as any,
    { placeholderData: keepPreviousData } as any
  )

  const rows = (designs ?? []) as any[]
  const selectedIds = useMemo(
    () => Object.keys(rowSelection).filter((id) => rowSelection[id]),
    [rowSelection]
  )

  /**
   * 🔴 Selected designs are accumulated across PAGES, not read off the current
   * one. `rows.filter(selected)` loses every pick the moment the operator
   * turns the page or types in the search box — and it loses them silently,
   * because the CommandBar count comes from the selection state and would
   * still say "3 selected" while only one survived into the order.
   */
  const [pickedById, setPickedById] = useState<Record<string, DesignForOrder>>({})
  const onRowSelectionChange = (next: DataTableRowSelectionState) => {
    setRowSelection(next)
    setPickedById((prev) => {
      const merged = { ...prev }
      // Only rows on THIS page are reconciled; picks made on other pages are
      // left alone, which is what makes the selection survive paging.
      for (const row of rows) {
        if (next[row.id]) {
          merged[row.id] = { id: row.id, customer_id: row.customer_id ?? null }
        } else {
          delete merged[row.id]
        }
      }
      return merged
    })
  }

  const picked = useMemo(() => Object.values(pickedById), [pickedById])

  const columns = useMemo(
    () => [
      columnHelper.select(),
      columnHelper.accessor("name", {
        header: "Design",
        cell: ({ getValue }) => (
          <Text size="small" leading="compact">
            {getValue() as string}
          </Text>
        ),
      }),
      columnHelper.accessor("status", {
        header: "Status",
        cell: ({ getValue }) => (
          <Badge size="2xsmall" color="grey">
            {String(getValue() ?? "—").replace(/_/g, " ")}
          </Badge>
        ),
      }),
      columnHelper.accessor("estimated_cost", {
        header: "Estimated cost",
        cell: ({ getValue }) => {
          const v = Number(getValue())
          return (
            <Text size="small" leading="compact" className="text-ui-fg-subtle">
              {Number.isFinite(v) && v > 0 ? v : "—"}
            </Text>
          )
        },
      }),
    ],
    []
  )

  const table = useDataTable({
    columns,
    data: rows,
    getRowId: (row) => row.id as string,
    rowCount: count ?? 0,
    isLoading,
    rowSelection: { state: rowSelection, onRowSelectionChange },
    pagination: { state: pagination, onPaginationChange: setPagination },
    search: { state: search, onSearchChange: setSearch },
  })

  const estimateRows = preview?.estimates ?? []
  const currency = preview?.currency_code ?? "inr"

  const estimateColumns = useMemo(
    () => [
      estimateHelper.accessor("name", {
        header: "Design",
        cell: ({ getValue, row }) => (
          <Text size="small" leading="compact">
            {(getValue() as string) || row.original.design_id}
          </Text>
        ),
      }),
      estimateHelper.accessor("confidence", {
        header: "Confidence",
        cell: ({ getValue }) => {
          const c = String(getValue() ?? "none")
          return (
            <Badge size="2xsmall" color={c === "none" ? "red" : c === "low" ? "orange" : "green"}>
              {c}
            </Badge>
          )
        },
      }),
      estimateHelper.accessor("material_cost", {
        header: "Material",
        cell: ({ getValue }) => <Money value={getValue() as number} currency={currency} />,
      }),
      estimateHelper.accessor("production_cost", {
        header: "Production",
        cell: ({ getValue }) => <Money value={getValue() as number} currency={currency} />,
      }),
      estimateHelper.accessor("total_estimated", {
        header: "Estimate",
        cell: ({ getValue }) => {
          /**
           * 🔴 `null` is NOT zero. The estimator returns null for a design it
           * could not price, and rendering that through a `?? 0` would put a
           * confident ₹0.00 on the row — the #1900 shape, in the one place an
           * operator decides whether the number is right.
           */
          const v = getValue() as number | null | undefined
          return v == null ? (
            <Badge size="2xsmall" color="red">Not priceable</Badge>
          ) : (
            <Text size="small" leading="compact" weight="plus">
              {money(v, currency)}
            </Text>
          )
        },
      }),
    ],
    [currency]
  )

  const estimateTable = useDataTable({
    columns: estimateColumns,
    data: estimateRows,
    getRowId: (row) => row.design_id,
    rowCount: estimateRows.length,
  })

  const goToReview = async () => {
    const resolved = resolveDesignOrderTarget(picked)
    if (!resolved.ok) {
      toast.error(resolved.error.title, { description: resolved.error.description })
      return
    }

    setIsPreviewing(true)
    try {
      const routes = designOrderRoutes(resolved.customer_id)
      const data = await sdk.client.fetch<PreviewResponse>(routes.preview, {
        method: "POST",
        body: { design_ids: resolved.design_ids },
      })
      setTarget({ customer_id: resolved.customer_id, design_ids: resolved.design_ids })
      setPreview(data)
      setStep(Step.REVIEW)
    } catch (err: any) {
      // Rendered, not swallowed — the message names what is missing.
      toast.error("Failed to estimate order", {
        description: err?.message || "An unexpected error occurred.",
      })
    } finally {
      setIsPreviewing(false)
    }
  }

  const create = async () => {
    if (!target) return
    setIsCreating(true)
    try {
      const routes = designOrderRoutes(target.customer_id)
      await sdk.client.fetch(routes.create, {
        method: "POST",
        body: designOrderCreateBody({ design_ids: target.design_ids }),
      })
      toast.success("Design order created", {
        description: target.customer_id
          ? "Share the checkout link with the customer to complete payment."
          : "No buyer is attached yet — attach one from the order, or it is collected at checkout.",
      })
      handleSuccess()
    } catch (err: any) {
      toast.error("Failed to create design order", {
        description: err?.message || "An unexpected error occurred.",
      })
    } finally {
      setIsCreating(false)
    }
  }

  const designsStatus: ProgressStatus =
    step === Step.REVIEW ? "completed" : picked.length ? "in-progress" : "not-started"
  const reviewStatus: ProgressStatus =
    step === Step.REVIEW ? "in-progress" : "not-started"

  return (
    <ProgressTabs
      value={step}
      onValueChange={(v) => {
        // Forward movement must go through `goToReview`, which is what
        // produces the estimate. Clicking the tab cannot skip that.
        if (v === Step.DESIGNS) setStep(Step.DESIGNS)
      }}
      className="flex h-full flex-col overflow-hidden"
    >
      <RouteFocusModal.Header>
        {/*
          Title, not a bare Heading. Radix refuses a DialogContent with no
          DialogTitle as accessible and logs it on every open — the drawer then
          announces itself to a screen reader with no name. `sr-only` because
          the ProgressTabs are the visible heading here.
        */}
        <RouteFocusModal.Title asChild>
          <span className="sr-only">Start a design order</span>
        </RouteFocusModal.Title>
        <div className="flex w-full items-center justify-between gap-x-4">
          <ProgressTabs.List className="flex items-center justify-start">
            <ProgressTabs.Trigger status={designsStatus} value={Step.DESIGNS}>
              Designs
            </ProgressTabs.Trigger>
            <ProgressTabs.Trigger
              status={reviewStatus}
              value={Step.REVIEW}
              disabled={!preview}
            >
              Review
            </ProgressTabs.Trigger>
          </ProgressTabs.List>
        </div>
      </RouteFocusModal.Header>

      <RouteFocusModal.Body className="size-full overflow-hidden">
        <ProgressTabs.Content
          value={Step.DESIGNS}
          /*
            🔴 NO `flex` on a ProgressTabs.Content. Radix hides the inactive
            panel with the `hidden` ATTRIBUTE, which is only `display: none`
            from the UA stylesheet — a Tailwind `flex` class beats it on
            specificity, so the hidden panel keeps its box and its full height.
            The other tab's content is then pushed below the fold and the step
            looks blank. Sizing here, layout on an inner div.
          */
          className="h-full overflow-y-auto"
        >
          <div className="flex h-full flex-col">
          <DataTable instance={table}>
            <DataTable.Toolbar className="flex items-center justify-between gap-x-2 px-0">
              <Heading level="h2">Choose designs</Heading>
              <DataTable.Search placeholder="Search designs…" />
            </DataTable.Toolbar>
            <DataTable.Table />
            <DataTable.Pagination />
          </DataTable>
          </div>
        </ProgressTabs.Content>

        <ProgressTabs.Content
          value={Step.REVIEW}
          /*
            Sizing on the Content, layout on an inner div — the shape
            create-inventory-order uses. `h-full` + `flex-col` on the same
            element bottom-pinned the rows behind a screenful of blank; no
            `h-full` at all collapsed it to nothing.
          */
          className="h-full overflow-y-auto"
        >
          <div className="flex flex-col gap-y-4">
          <div>
            <Heading level="h2">Review</Heading>
            <Text size="small" leading="compact" className="text-ui-fg-subtle">
              {target?.customer_id
                ? "This order is for the customer these designs belong to."
                : "No buyer yet. A design order without one is ordinary — attach a buyer from the order, or it is collected at checkout."}
            </Text>
          </div>

          <DataTable instance={estimateTable}>
            <DataTable.Table />
          </DataTable>

          <div className="flex items-center justify-between rounded-md border border-ui-border-base bg-ui-bg-subtle px-4 py-3">
            <div className="flex flex-col">
              <Text size="small" weight="plus">
                {preview?.total_is_complete === false ? "Total (partial)" : "Total"}
              </Text>
              {preview?.total_is_complete === false && (
                /*
                  🔴 Said out loud. When the estimator could not price every
                  design, `total` is a SUM OF WHAT IT COULD — a number that
                  looks like the order's value and is not. Presenting it
                  unqualified is how an operator commits to a figure the
                  customer will exceed.
                */
                <Text size="xsmall" leading="compact" className="text-ui-fg-subtle">
                  Some designs could not be priced. This is the sum of the rest.
                </Text>
              )}
            </div>
            <Text size="small" weight="plus">
              {money(preview?.total ?? 0, currency)}
            </Text>
          </div>
          </div>
        </ProgressTabs.Content>
      </RouteFocusModal.Body>

      <RouteFocusModal.Footer>
        <div className="flex items-center justify-end gap-x-2">
          <RouteFocusModal.Close asChild>
            <Button size="small" variant="secondary">
              Cancel
            </Button>
          </RouteFocusModal.Close>
          {step === Step.DESIGNS ? (
            <Button
              size="small"
              onClick={goToReview}
              isLoading={isPreviewing}
              disabled={!picked.length}
            >
              Continue
            </Button>
          ) : (
            <>
              <Button
                size="small"
                variant="secondary"
                onClick={() => setStep(Step.DESIGNS)}
                disabled={isCreating}
              >
                Back
              </Button>
              <Button size="small" onClick={create} isLoading={isCreating}>
                Create order
              </Button>
            </>
          )}
        </div>
      </RouteFocusModal.Footer>

      {/*
        The selection lives in the CommandBar rather than in a line of text, so
        the count and the way to clear it are in the same place — and it stays
        visible while the operator pages through or searches, which is exactly
        when a cross-page selection is easy to forget about.
      */}
      <CommandBar open={picked.length > 0}>
        <CommandBar.Bar>
          <CommandBar.Value>
            {picked.length} design{picked.length === 1 ? "" : "s"} selected
          </CommandBar.Value>
          <CommandBar.Seperator />
          <CommandBar.Command
            action={() => {
              setRowSelection({})
              setPickedById({})
            }}
            label="Clear"
            shortcut="c"
          />
          {step === Step.DESIGNS && (
            <>
              <CommandBar.Seperator />
              <CommandBar.Command action={goToReview} label="Continue" shortcut="r" />
            </>
          )}
        </CommandBar.Bar>
      </CommandBar>
    </ProgressTabs>
  )
}
