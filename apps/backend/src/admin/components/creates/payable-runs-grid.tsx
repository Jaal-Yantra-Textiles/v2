import { useEffect, useMemo } from "react"
import { useForm, useWatch } from "react-hook-form"
import { Badge, CommandBar, Container, Text } from "@medusajs/ui"

import { DataGrid } from "../data-grid/data-grid"
import {
  DataGridBooleanCell,
  DataGridNumberCell,
  DataGridReadOnlyCell,
} from "../data-grid/components"
import { createDataGridHelper } from "../data-grid/helpers/create-data-grid-column-helper"
import { PayableRun } from "../../hooks/api/payment-submissions"

/**
 * The payable runs, as a spreadsheet.
 *
 * ## Why a grid
 *
 * This screen is where an operator decides what a partner gets paid, and the
 * decision is made across rows rather than within one: is this rate the same as
 * that rate, does this run's quantity match the one below it, which of these
 * twelve am I billing today. The stacked cards it replaces put every row in its
 * own box and every number in its own tab-stop, so comparing two runs meant
 * scrolling between two cards and holding a figure in your head.
 *
 * A grid also brings the thing the card list could not: arrow-key navigation,
 * shift-select down a column, and copy/paste — so setting the same rate on ten
 * runs is one gesture rather than ten.
 *
 * ## The form is a mirror, not the source of truth
 *
 * The parent still owns selection and the overrides, because the submit path,
 * the totals, and the design/task panels all read from there. This grid keeps a
 * form shaped like its rows and reports changes UP. Making the form
 * authoritative would mean rewriting the submit path at the same time as the
 * table, and a payout screen is not where two rewrites should meet.
 *
 * 🔴 `selected` is a real grid column rather than a checkbox bolted to the left
 * edge, precisely so it can be dragged and pasted like any other. That is the
 * bulk selection the card list never had.
 *
 * ⚠️ A row that is already BILLED is rendered, not filtered — "why isn't this
 * run here" is the question an operator arrives with — but its cells are
 * read-only, so the grid cannot select something the submit guard will refuse.
 */

type RunRow = {
  run: PayableRun
  index: number
}

type GridValues = {
  rows: Array<{
    selected: boolean
    quantity: number
    rate: number
  }>
}

const round2 = (n: number) => Math.round(n * 100) / 100

export const PayableRunsGrid = ({
  runs,
  isLoading,
  selectedIds,
  quantityOverrides,
  rateOverrides,
  onSelectionChange,
  onQuantityChange,
  onRateChange,
  onClearSelection,
  getQuantity,
  getRate,
  getAmount,
  billsVerbatimTotal,
  hasTypedRate,
  needsTypedPrice,
}: {
  runs: PayableRun[]
  isLoading: boolean
  selectedIds: Set<string>
  quantityOverrides: Record<string, number>
  rateOverrides: Record<string, number>
  onSelectionChange: (runId: string, selected: boolean) => void
  onQuantityChange: (runId: string, value: string) => void
  onRateChange: (runId: string, value: string) => void
  onClearSelection: () => void
  getQuantity: (run: PayableRun) => number
  getRate: (run: PayableRun) => number
  getAmount: (run: PayableRun) => number
  /** Whether this row still bills an agreed TOTAL rather than a typed rate. */
  billsVerbatimTotal: (run: PayableRun) => boolean
  /** Whether a human has typed a rate for this run. */
  hasTypedRate: (run: PayableRun) => boolean
  /**
   * Whether this row states no price of its own until somebody types one — an
   * agreed TOTAL on a run part of which is already billed (#1596/#1676).
   */
  needsTypedPrice: (run: PayableRun) => boolean
}) => {
  const rows: RunRow[] = useMemo(
    () => runs.map((run, index) => ({ run, index })),
    [runs]
  )

  const form = useForm<GridValues>({
    defaultValues: {
      rows: runs.map((run) => ({
        selected: selectedIds.has(run.run_id),
        quantity: getQuantity(run),
        rate: getRate(run),
      })),
    },
  })

  /**
   * Re-seed when the partner changes and a different set of runs arrives.
   *
   * Keyed on the run ids rather than on `runs` itself: the query refetches and
   * hands back a new array for the same runs, and resetting on identity would
   * wipe a rate an operator was halfway through typing.
   */
  const runKey = runs.map((r) => r.run_id).join(",")
  useEffect(() => {
    form.reset({
      rows: runs.map((run) => ({
        selected: selectedIds.has(run.run_id),
        quantity: getQuantity(run),
        rate: getRate(run),
      })),
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runKey])

  const watched = useWatch({ control: form.control, name: "rows" }) as
    | GridValues["rows"]
    | undefined

  /**
   * Push grid edits back to the parent.
   *
   * Each field is compared against what the parent already holds before being
   * reported, so a re-render cannot loop, and a value the operator did not
   * touch is never announced as a change.
   */
  useEffect(() => {
    if (!watched) {
      return
    }
    watched.forEach((row, index) => {
      const run = runs[index]
      if (!run) {
        return
      }

      /**
       * 🔴 `billing_status`, not `!run.billed` — the THIRD place this shortcut
       * appeared, and the one that made the other two useless. `billed` is
       * truthy for a PARTLY billed run, so this effect reported every such
       * row's selection back as `false`: the checkbox ticked in the grid, the
       * parent never heard it, `totalSelected` stayed 0 and the Create
       * Submission button stayed disabled forever. A row that can be selected
       * and can never be submitted is worse than one that is filtered out.
       *
       * Found by rendering the screen. Nothing in tsc or the suite could see
       * it — the grid's own state was correct throughout.
       */
      const nextSelected =
        !!row?.selected && run.billing_status !== "billed"
      if (nextSelected !== selectedIds.has(run.run_id)) {
        onSelectionChange(run.run_id, nextSelected)
      }

      const nextQty = Number(row?.quantity)
      if (Number.isFinite(nextQty) && nextQty !== getQuantity(run)) {
        onQuantityChange(run.run_id, String(nextQty))
      }

      const nextRate = Number(row?.rate)
      if (Number.isFinite(nextRate) && nextRate !== getRate(run)) {
        onRateChange(run.run_id, String(nextRate))
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watched])

  const columnHelper = createDataGridHelper<RunRow, GridValues>()

  const columns = useMemo(
    () => [
      columnHelper.column({
        id: "selected",
        name: "Bill",
        header: "Bill",
        field: (context: any) => `rows.${context.row.index}.selected`,
        type: "boolean",
        disableHiding: true,
        cell: (context: any) => (
          <DataGridBooleanCell
            context={context}
            // A run billed IN FULL cannot be billed again. Disabled rather
            // than absent: the row still answers "where is this run".
            //
            // ⚠️ `billing_status`, not `billed` — `billed` is truthy for a
            // PARTLY billed run too, and its remainder is billable (#1596).
            disabled={
              rows[context.row.index]?.run.billing_status === "billed"
            }
          />
        ),
      }),
      columnHelper.column({
        id: "design",
        name: "Design",
        header: "Design",
        disableHiding: true,
        cell: (context: any) => {
          const run = rows[context.row.index]?.run
          if (!run) {
            return <DataGridReadOnlyCell context={context} />
          }
          return (
            <DataGridReadOnlyCell context={context}>
              {/*
                🔑 The run's identity lives on the DESIGN cell, because the grid
                renders its own rows and there is no hook for a per-row
                attribute. Tests address the row through this cell.
                ⚠️ The FULL id: the seed's runs are created in the same
                millisecond, so their ULIDs share a 16-char prefix and a
                truncated match hits two different runs.
              */}
              <div
                className="flex w-full items-center gap-x-2 overflow-hidden"
                data-testid="payable-run-row"
                data-run-id={run.run_id}
              >
                <Text size="small" className="truncate">
                  {run.design_name || "Unnamed design"}
                </Text>
                {run.billing_status === "billed" && (
                  <Badge color="orange" size="2xsmall" className="shrink-0">
                    paid
                  </Badge>
                )}
                {/*
                  #1596 — SOME of this run is already paid for, and what is on
                  offer is the remainder. Without the badge the row looks like
                  any other and the Qty column silently holds a smaller number
                  than the Output column beside it.
                */}
                {run.billing_status === "partly_billed" && (
                  <Badge color="blue" size="2xsmall" className="shrink-0">
                    {run.billable_remaining != null
                      ? `${run.billable_remaining} left`
                      : "part billed"}
                  </Badge>
                )}
                {!run.payable && run.billing_status !== "billed" && (
                  <Badge color="orange" size="2xsmall" className="shrink-0">
                    no rate
                  </Badge>
                )}
                {/*
                  🔴 An agreed TOTAL that has already been billed against. The
                  total was the price for the WHOLE job, so the remainder has
                  no figure of its own — re-billing it double-pays and
                  dividing it re-prices. The row bills 0 until someone states
                  what the rest is worth, and the submit guard refuses it.
                */}
                {needsTypedPrice(run) && (
                  <Badge color="red" size="2xsmall" className="shrink-0">
                    price the rest
                  </Badge>
                )}
                {/* #1596 — the produced/ordered gap on this row is SETTLED. */}
                {run.short_closed_at && (
                  <Badge color="grey" size="2xsmall" className="shrink-0">
                    closed
                  </Badge>
                )}
                {/*
                  🔴 An agreed TOTAL, not a rate. The Rate column beside it is
                  a division done for display, and a grid invites copying a
                  column down — so the row has to say which of its numbers was
                  actually negotiated.
                */}
                {billsVerbatimTotal(run) && (
                  <Badge color="blue" size="2xsmall" className="shrink-0">
                    total
                  </Badge>
                )}
              </div>
            </DataGridReadOnlyCell>
          )
        },
      }),
      columnHelper.column({
        id: "output",
        name: "Output",
        header: "Output",
        cell: (context: any) => {
          const run = rows[context.row.index]?.run
          if (!run) {
            return <DataGridReadOnlyCell context={context} />
          }
          return (
            <DataGridReadOnlyCell context={context}>
              <Text size="small" className="truncate">
                {/* #1676 — an open-ended run has no denominator, and "40 of no
                  * agreed qty" reads as a broken sentence. */}
                {run.ordered_quantity == null
                  ? `${run.produced_quantity ?? "—"} produced · no agreed qty`
                  : `${run.produced_quantity ?? "—"} of ${run.ordered_quantity}`}
                {/**
                  * ⚠️ Read "was output recorded" off `produced_quantity`, NOT
                  * off `quantity_basis`. Since #1676 the offer is capped at the
                  * ordered figure, so an OVERPRODUCED run reports its basis as
                  * "ordered" while having recorded output — inferring the note
                  * from the basis printed "12 of 9 · no output recorded".
                  *
                  * ⚠️ Kept SHORT — the cell truncates, and "billing capped at
                  * ordered" was cut to "…capped at or…". The Qty column beside
                  * it already shows the clamped figure.
                  */}
                {run.produced_quantity == null
                  ? " · no output recorded"
                  : run.ordered_quantity != null &&
                      run.produced_quantity > run.ordered_quantity
                    ? " · billing capped"
                    : run.short_closed_at
                      ? " · closed short"
                      : ""}
              </Text>
            </DataGridReadOnlyCell>
          )
        },
      }),
      columnHelper.column({
        id: "quantity",
        name: "Qty",
        header: "Qty",
        field: (context: any) => `rows.${context.row.index}.quantity`,
        type: "number",
        cell: (context: any) => (
          // 🔴 NO `min` here (#1671). It becomes a native `min` attribute, and
          // native constraint validation refuses the whole form BEFORE any
          // handler runs — silently, with no submit event to observe.
          <DataGridNumberCell context={context} />
        ),
      }),
      columnHelper.column({
        id: "rate",
        name: "Rate",
        header: "Rate",
        field: (context: any) => `rows.${context.row.index}.rate`,
        type: "number",
        cell: (context: any) => <DataGridNumberCell context={context} />,
      }),
      columnHelper.column({
        id: "basis",
        name: "Priced on",
        header: "Priced on",
        cell: (context: any) => {
          const run = rows[context.row.index]?.run
          if (!run) {
            return <DataGridReadOnlyCell context={context} />
          }
          /**
           * What the Rate box actually IS, in words.
           *
           * "derived" means the run was agreed as a total and the rate beside
           * it is that total divided out — so changing the quantity does not
           * change what is owed. Typing a rate is the deliberate way to make
           * this row per-piece, and the label changes when you do.
           */
          return (
            <DataGridReadOnlyCell context={context}>
              <Text size="small" className="truncate">
                {billsVerbatimTotal(run)
                  ? "agreed total · rate derived"
                  : hasTypedRate(run)
                    ? "rate you typed"
                    : run.payable
                      ? "agreed rate"
                      : // Not "rate you typed" — nobody has. The run finished
                        // and no price was ever recorded, which is a gap in the
                        // record rather than a price of zero (#1554).
                        "no rate yet"}
              </Text>
            </DataGridReadOnlyCell>
          )
        },
      }),
      columnHelper.column({
        id: "amount",
        name: "Amount",
        header: "Amount",
        cell: (context: any) => {
          const run = rows[context.row.index]?.run
          if (!run) {
            return <DataGridReadOnlyCell context={context} />
          }
          /**
           * ⚠️ Derived from the CELLS, not from `run.amount`.
           *
           * For a `cost_type: "total"` run the agreed total is not
           * quantity × rate, and the rate shown is divided back out for display
           * (#1596). Once an operator retypes either box, the only honest
           * amount is the one their own two numbers make — which is also the
           * one the submit path writes.
           */
          const rate = getRate(run)
          return (
            <DataGridReadOnlyCell context={context}>
              <Text
                size="small"
                className="truncate tabular-nums"
                data-testid={`run-amount-${run.run_id}`}
              >
                {/*
                  An em dash, not a zero, while no rate has been given. "0" here
                  reads as an agreed price of nothing, which is a different
                  claim from "nobody has said what this costs yet" (#1554).
                */}
                {rate > 0 ? getAmount(run).toLocaleString() : "—"}
              </Text>
            </DataGridReadOnlyCell>
          )
        },
      }),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, quantityOverrides, rateOverrides]
  )

  const sizedColumns = useMemo(
    () =>
      columns.map((col: any) => {
        if (col.id === "selected") return { ...col, size: 72, maxSize: 88 }
        if (col.id === "design") return { ...col, size: 320, maxSize: 520 }
        if (col.id === "output") return { ...col, size: 220, maxSize: 300 }
        if (col.id === "quantity") return { ...col, size: 120, maxSize: 160 }
        if (col.id === "rate") return { ...col, size: 130, maxSize: 200 }
        if (col.id === "basis") return { ...col, size: 200, maxSize: 260 }
        if (col.id === "amount") return { ...col, size: 140, maxSize: 200 }
        return col
      }),
    [columns]
  )

  const selectedRuns = runs.filter((r) => selectedIds.has(r.run_id))
  const selectedTotal = round2(
    selectedRuns.reduce((sum, run) => sum + getAmount(run), 0)
  )

  if (isLoading) {
    return (
      <Container className="p-8">
        <Text className="text-ui-fg-subtle text-center">
          Loading production runs...
        </Text>
      </Container>
    )
  }

  if (!runs.length) {
    return (
      <Container className="p-8">
        <Text className="text-ui-fg-subtle text-center">
          No completed production runs for this partner. A run has to be
          completed before it can be paid for.
        </Text>
      </Container>
    )
  }

  /**
   * ⚠️ `billing_status`, not `!r.billed` — `billed` is truthy for a PARTLY
   * billed run, whose remainder is billable and whose row is selectable. The
   * count said "0 billable of 2" above two rows an operator could bill.
   */
  const selectableCount = runs.filter(
    (r) => r.billing_status !== "billed"
  ).length

  return (
    <div className="flex flex-col gap-y-2">
      <div className="flex items-center justify-between">
        <Text size="small" className="text-ui-fg-subtle">
          {selectableCount} billable of {runs.length}
        </Text>
        <Text size="xsmall" className="text-ui-fg-muted">
          Arrow keys to move · Enter to edit · ⇧↓ to extend · ⌘C/⌘V to fill down
        </Text>
      </div>

      <DataGrid
        data={rows}
        columns={sizedColumns as any}
        state={form}
        multiColumnSelection
      />

      {runs.some((r) => billsVerbatimTotal(r)) && (
        <Text size="xsmall" className="text-ui-fg-subtle">
          Rows marked <span className="font-medium">total</span> were agreed as
          a price for the job, not per piece. Their amount is that agreed total
          and does not move with the quantity. Type a rate to price one per
          piece instead.
        </Text>
      )}

      {/*
        The running total, where the decision is being made. The header's
        Create button is the other end of the room from the rows being
        chosen, and an operator selecting twelve runs had no way to see what
        they added up to until after the submission existed.
      */}
      <CommandBar open={selectedRuns.length > 0}>
        <CommandBar.Bar>
          <CommandBar.Value>
            {selectedRuns.length} run{selectedRuns.length === 1 ? "" : "s"} ·{" "}
            {selectedTotal.toLocaleString()}
          </CommandBar.Value>
          <CommandBar.Seperator />
          <CommandBar.Command
            action={onClearSelection}
            label="Clear"
            shortcut="c"
          />
        </CommandBar.Bar>
      </CommandBar>
    </div>
  )
}
