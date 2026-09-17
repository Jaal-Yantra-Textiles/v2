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
import { useEffect, useMemo, useState } from "react"
import { useForm } from "react-hook-form"

import { DataGrid } from "../data-grid/data-grid"
import { DataGridCurrencyCell, DataGridReadOnlyCell } from "../data-grid/components"
import { createDataGridHelper } from "../data-grid/helpers/create-data-grid-column-helper"
import { KeyboundForm } from "../utilitites/key-bound-form"
import { DesignOrderCreatedPanel, type CreatedDesignOrder } from "./design-order-created-panel"
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
  /**
   * The links the create returned. A third step rather than a toast: the
   * operator was previously told to "share the checkout link" and handed
   * nothing, because both call sites discarded the response.
   */
  CREATED = "created",
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
/** One editable review row. `price` is what the order will actually list. */
type LineForm = {
  design_id: string
  name: string
  /** What the estimator said. null when it could not price the design. */
  estimated: number | null
  confidence: string
  /** Editable. Seeded from `estimated`; any change becomes a price override. */
  price: number
}

type WizardForm = { lines: LineForm[] }

const PAGE_SIZE = 10
const columnHelper = createDataTableColumnHelper<any>()
const gridHelper = createDataGridHelper<LineForm, WizardForm>()

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
  const [created, setCreated] = useState<CreatedDesignOrder | null>(null)
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

  /**
   * The review rows are a FORM, not a read-only summary.
   *
   * 🔴 The modal this replaces could override a price before creating the
   * order (`price_overrides` on both create doors). Rebuilding the review as a
   * static table silently removed that — the operator could see a wrong
   * estimate and had no way to correct it without abandoning the flow. An
   * editable `DataGrid` is what that capability looks like in this admin, and
   * it is the same component `create-inventory-order` uses for order lines.
   */
  const form = useForm<WizardForm>({ defaultValues: { lines: [] } })
  const lines = form.watch("lines") ?? []

  useEffect(() => {
    if (!preview) return
    form.reset({
      lines: preview.estimates.map((e) => ({
        design_id: e.design_id,
        name: e.name ?? e.design_id,
        estimated: e.total_estimated ?? null,
        confidence: String(e.confidence ?? "none"),
        // Seeded from the estimate. `?? 0` ONLY as the starting value of an
        // editable cell — an unpriceable design opens at 0 so it can be typed
        // over, and the grid marks it so nobody mistakes it for a real figure.
        price: e.total_estimated ?? 0,
      })),
    })
  }, [preview])

  const gridColumns = useMemo(
    () => [
      gridHelper.column({
        id: "name",
        name: "Design",
        header: "Design",
        cell: (context: any) => (
          <DataGridReadOnlyCell context={context}>
            <Text size="small" leading="compact">
              {lines[context.row.index]?.name ?? "—"}
            </Text>
          </DataGridReadOnlyCell>
        ),
        disableHiding: true,
      }),
      gridHelper.column({
        id: "confidence",
        name: "Confidence",
        header: "Confidence",
        cell: (context: any) => {
          const c = lines[context.row.index]?.confidence ?? "none"
          return (
            <DataGridReadOnlyCell context={context}>
              <Badge size="2xsmall" color={c === "none" ? "red" : c === "low" ? "orange" : "green"}>
                {c}
              </Badge>
            </DataGridReadOnlyCell>
          )
        },
      }),
      gridHelper.column({
        id: "estimated",
        name: "Estimated",
        header: "Estimated",
        cell: (context: any) => {
          /**
           * 🔴 `null` is NOT zero. The estimator returns null for a design it
           * could not price; rendering that through a `?? 0` would put a
           * confident ₹0.00 beside it — the #1900 shape, in the one place an
           * operator decides whether the number is right.
           */
          const v = lines[context.row.index]?.estimated
          return (
            <DataGridReadOnlyCell context={context}>
              {v == null ? (
                <Badge size="2xsmall" color="red">Not priceable</Badge>
              ) : (
                <Text size="small" leading="compact" className="text-ui-fg-subtle">
                  {money(v, currency)}
                </Text>
              )}
            </DataGridReadOnlyCell>
          )
        },
      }),
      gridHelper.column({
        id: "price",
        name: "Price",
        header: "Price",
        field: (context: any) => `lines.${context.row.index}.price` as const,
        type: "number",
        cell: (context: any) => (
          <DataGridCurrencyCell context={context} code={currency} />
        ),
        disableHiding: true,
      }),
    ],
    [lines, currency]
  )

  /**
   * Widths, the way `inventory-order-lines-grid` does it. Left at the default
   * the design name — the only column that tells you WHICH garment you are
   * pricing — truncates to about twenty characters, and two fixtures with the
   * same prefix become indistinguishable at the moment money is entered.
   */
  const sizedGridColumns = useMemo(
    () =>
      gridColumns.map((col: any) => {
        // 320, not 460: the four columns then fit inside a ~900px modal, so the
        // editable Price cell is on screen without scrolling. It is the one
        // cell the operator must reach.
        if (col.id === "name") return { ...col, size: 320, maxSize: 640 }
        if (col.id === "confidence") return { ...col, size: 150, maxSize: 180 }
        if (col.id === "estimated") return { ...col, size: 180, maxSize: 220 }
        if (col.id === "price") return { ...col, size: 200, maxSize: 260 }
        return col
      }),
    [gridColumns]
  )

  /** Only prices the operator actually changed travel as overrides. */
  const overrides = useMemo(() => {
    const out: Record<string, number> = {}
    for (const l of lines) {
      const n = Number(l.price)
      if (!Number.isFinite(n) || n <= 0) continue
      if (l.estimated == null || n !== Number(l.estimated)) out[l.design_id] = n
    }
    return out
  }, [lines])

  const grandTotal = useMemo(
    () => lines.reduce((sum, l) => sum + (Number(l.price) || 0), 0),
    [lines]
  )

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
      const created = await sdk.client.fetch<CreatedDesignOrder>(routes.create, {
        method: "POST",
        body: designOrderCreateBody({
          design_ids: target.design_ids,
          price_overrides: overrides,
          // The cart's currency is the estimate's currency; sending a price in
          // any other would be valued by one number and labelled by another.
          override_currency: currency,
        }),
      })
      toast.success("Design order created", {
        description: target.customer_id
          ? undefined
          : "No buyer is attached yet — attach one from the order, or it is collected at checkout.",
      })
      // Show the links rather than dismissing. `handleSuccess` runs from the panel.
      setCreated(created)
      setStep(Step.CREATED)
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

  /**
   * The links REPLACE the wizard rather than becoming a third tab. The basket
   * and its estimate are spent by the time this shows, and a tab the operator
   * could click back into would offer to create the same order a second time.
   */
  if (step === Step.CREATED && created) {
    return (
      <div className="flex h-full flex-col overflow-hidden">
        <RouteFocusModal.Header>
          {/* Radix refuses a DialogContent with no DialogTitle; see below. */}
          <RouteFocusModal.Title asChild>
            <span className="sr-only">Design order created</span>
          </RouteFocusModal.Title>
        </RouteFocusModal.Header>
        <RouteFocusModal.Body className="size-full overflow-auto">
          <DesignOrderCreatedPanel result={created} onDone={handleSuccess} />
        </RouteFocusModal.Body>
      </div>
    )
  }

  return (
    <RouteFocusModal.Form form={form}>
      <KeyboundForm
        onSubmit={(e) => e.preventDefault()}
        className="flex h-full flex-col overflow-hidden"
      >
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
          <div className="flex h-full flex-col px-4 py-4 md:px-6">
          <DataTable instance={table}>
            {/* Wraps to two rows when the modal is narrow, rather than
                crushing the search field against the heading. */}
            <DataTable.Toolbar className="flex flex-col items-stretch gap-2 px-0 md:flex-row md:items-center md:justify-between">
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
          <div className="flex flex-col gap-y-4 px-4 py-4 md:px-6">
          <div className="flex flex-col gap-y-1">
            <Heading level="h2">Review</Heading>
            {/* `max-w-prose` so the sentence wraps at a readable measure
                instead of running the full width of a wide modal. */}
            <Text size="small" leading="compact" className="max-w-prose text-ui-fg-subtle">
              {target?.customer_id
                ? "This order is for the customer these designs belong to."
                : "No buyer yet. A design order without one is ordinary — attach a buyer from the order, or it is collected at checkout."}
            </Text>
          </div>

          {/*
            The grid keeps its column widths and scrolls sideways on a narrow
            screen. Letting it shrink instead squeezes the editable Price cell
            until the figure is unreadable — the one cell that must not be.
          */}
          <div className="min-w-0 overflow-x-auto">
            <DataGrid data={lines} columns={sizedGridColumns} state={form} />
          </div>
          <Text size="xsmall" leading="compact" className="max-w-prose text-ui-fg-muted">
            Prices are editable — Enter moves between cells. Anything you change
            is sent as a price override; untouched rows keep the estimate.
          </Text>

          <div className="flex flex-col gap-y-2 rounded-md border border-ui-border-base bg-ui-bg-subtle px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-y-0">
            <div className="flex min-w-0 flex-col">
              <Text size="small" weight="plus">
                {Object.keys(overrides).length
                  ? "Total (with your prices)"
                  : preview?.total_is_complete === false
                    ? "Total (partial)"
                    : "Total"}
              </Text>
              {preview?.total_is_complete === false && (
                /*
                  🔴 Said out loud. When the estimator could not price every
                  design, `total` is a SUM OF WHAT IT COULD — a number that
                  looks like the order's value and is not. Presenting it
                  unqualified is how an operator commits to a figure the
                  customer will exceed.
                */
                <Text size="xsmall" leading="compact" className="max-w-prose text-ui-fg-subtle">
                  Some designs could not be priced. This is the sum of the rest.
                </Text>
              )}
            </div>
            <Text size="small" weight="plus" className="tabular-nums">
              {money(grandTotal, currency)}
            </Text>
          </div>
          </div>
        </ProgressTabs.Content>
      </RouteFocusModal.Body>

      <RouteFocusModal.Footer>
        <div className="flex flex-wrap items-center justify-end gap-2">
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
      </KeyboundForm>
    </RouteFocusModal.Form>
  )
}
