import { useCallback, useMemo, useState } from "react"
import { useNavigate } from "react-router-dom"
import {
  Badge,
  Checkbox,
  CommandBar,
  Container,
  Input,
  Table,
  Text,
  Textarea,
  Tooltip,
  toast,
} from "@medusajs/ui"

import { RouteFocusModal } from "../../../components/modals"
import {
  usePartnerAssignedTasks,
  type PartnerAssignedTask,
} from "../../../hooks/api/partner-assigned-tasks"
import { useCreatePartnerPaymentSubmission } from "../../../hooks/api/partner-payment-submissions"
import {
  usePartnerPayableRuns,
  type PayableRun,
} from "../../../hooks/api/partner-payable-runs"

const ELIGIBLE_TASK_STATUSES = ["completed"]

const getRunUnitCost = (run: PayableRun): number => run.unit_amount

const getTaskCost = (t: PartnerAssignedTask): number =>
  Number(t.actual_cost ?? t.estimated_cost ?? 0)

export const PaymentSubmissionCreate = () => {
  const navigate = useNavigate()
  /**
   * One table of payable WORK, filtered — not a tab per source.
   *
   * A partner is answering "what am I owed for?", and the answer is a mix: runs
   * they finished and tasks they did. Splitting that across tabs made the total
   * in the header the only place the two were ever added up, so the screen
   * could show "0 items" on the tab you were looking at while you had picks on
   * the other one.
   *
   * Tasks are NOT redundant with runs. Most hang off a run, but a partner can
   * hold standalone ones, and this screen is the only place they can be billed.
   */
  const [typeFilter, setTypeFilter] = useState<"all" | "runs" | "tasks">("all")
  /** Reveal the rows that cannot be submitted, greyed out, with the reason. */
  const [showSubmitted, setShowSubmitted] = useState(false)
  const [selectedRunIds, setSelectedRunIds] = useState<Set<string>>(
    new Set()
  )
  const [selectedTaskIds, setSelectedTaskIds] = useState<Set<string>>(
    new Set()
  )
  const [runQuantities, setRunQuantities] = useState<Record<string, number>>({})
  const [runUnitAmounts, setRunUnitAmounts] = useState<Record<string, number>>({})
  const [taskCostOverrides, setTaskCostOverrides] = useState<
    Record<string, number>
  >({})
  const [notes, setNotes] = useState("")

  // Fetch payable runs and tasks in parallel
  const { payable_runs = [], isPending: runsLoading } = usePartnerPayableRuns()
  const { tasks = [], isPending: tasksLoading } = usePartnerAssignedTasks()

  /**
   * Why a run cannot be submitted right now, or null when it can.
   *
   * 🔴 `design_has_open_submission` is the one that used to get through. The
   * endpoint computes it and this screen never read it, so a run whose design
   * already sits in an open submission was offered, selected, and submitted —
   * and the workflow refused the whole request with "Designs already in an
   * active payment submission". A partner could not tell which row caused it,
   * because nothing on the screen said any row was different.
   *
   * A payment line is keyed by DESIGN, so the block is per design, not per run:
   * a second run of the same design is unbillable until the first submission is
   * resolved, however clean that run looks on its own.
   */
  const runBlockedReason = useCallback(
    (r: PayableRun): string | null => {
      if (r.billing_status === "billed") {
        return r.billed?.submission_id
          ? `Already paid · ${r.billed.submission_id}`
          : "Already paid"
      }
      if (r.design_has_open_submission) {
        return "This design is already in an open submission"
      }
      return null
    },
    []
  )

  const submittableRuns = useMemo(
    () => payable_runs.filter((r: PayableRun) => !runBlockedReason(r)),
    [payable_runs, runBlockedReason]
  )

  const blockedRuns = useMemo(
    () => payable_runs.filter((r: PayableRun) => !!runBlockedReason(r)),
    [payable_runs, runBlockedReason]
  )

  /**
   * Only the submittable rows may ever be selected. Everything downstream —
   * totals, validation, the payload — reads this, so a blocked row cannot reach
   * the request even if it is on screen.
   */
  const eligibleRuns = submittableRuns

  const eligibleTasks = useMemo(
    () =>
      tasks.filter(
        (t: PartnerAssignedTask) =>
          ELIGIBLE_TASK_STATUSES.includes(t.status || "") &&
          !t.parent_task_id // submit standalone/parent tasks only, not subtasks
      ),
    [tasks]
  )

  const { mutateAsync: createSubmission, isPending: isCreating } =
    useCreatePartnerPaymentSubmission()

  // ─── Selection handlers ─────────────────────────────────────────────
  const toggleRun = useCallback((id: string) => {
    setSelectedRunIds((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }, [])

  const toggleTask = useCallback((id: string) => {
    setSelectedTaskIds((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }, [])

  /**
   * Select-all acts on what is ON SCREEN, not on everything selectable.
   *
   * There used to be one per tab. With a single filtered table that would be a
   * trap: pressing it while filtered to Tasks and having it also tick every run
   * would bill work the partner never looked at, and the command bar total is
   * the only place they would notice.
   */
  const visibleSelectableRuns = useMemo(
    () => (typeFilter === "tasks" ? [] : eligibleRuns),
    [typeFilter, eligibleRuns]
  )
  const visibleSelectableTasks = useMemo(
    () => (typeFilter === "runs" ? [] : eligibleTasks),
    [typeFilter, eligibleTasks]
  )

  const allVisibleSelected =
    visibleSelectableRuns.length + visibleSelectableTasks.length > 0 &&
    visibleSelectableRuns.every((r: PayableRun) => selectedRunIds.has(r.run_id)) &&
    visibleSelectableTasks.every((t: PartnerAssignedTask) =>
      selectedTaskIds.has(t.id)
    )

  const toggleSelectAllVisible = useCallback(() => {
    if (allVisibleSelected) {
      setSelectedRunIds(new Set())
      setSelectedTaskIds(new Set())
      return
    }
    setSelectedRunIds(
      new Set(visibleSelectableRuns.map((r: PayableRun) => r.run_id))
    )
    setSelectedTaskIds(
      new Set(visibleSelectableTasks.map((t: PartnerAssignedTask) => t.id))
    )
  }, [allVisibleSelected, visibleSelectableRuns, visibleSelectableTasks])

  // ─── Cost helpers ───────────────────────────────────────────────────
  const getEffectiveRunQuantity = useCallback(
    (run: PayableRun): number => {
      if (runQuantities[run.run_id] != null)
        return runQuantities[run.run_id]
      return run.payable_quantity
    },
    [runQuantities]
  )

  const getEffectiveRunUnitAmount = useCallback(
    (run: PayableRun): number => {
      if (runUnitAmounts[run.run_id] != null)
        return runUnitAmounts[run.run_id]
      return getRunUnitCost(run)
    },
    [runUnitAmounts]
  )

  const getEffectiveRunTotal = useCallback(
    (run: PayableRun): number => {
      return getEffectiveRunQuantity(run) * getEffectiveRunUnitAmount(run)
    },
    [getEffectiveRunQuantity, getEffectiveRunUnitAmount]
  )

  const getEffectiveTaskCost = useCallback(
    (task: PartnerAssignedTask): number => {
      if (taskCostOverrides[task.id] != null)
        return taskCostOverrides[task.id]
      return getTaskCost(task)
    },
    [taskCostOverrides]
  )

  const handleRunQuantityChange = (runId: string, value: string) => {
    const num = parseFloat(value)
    if (value === "" || isNaN(num)) {
      setRunQuantities((prev) => {
        const next = { ...prev }
        delete next[runId]
        return next
      })
    } else {
      setRunQuantities((prev) => ({ ...prev, [runId]: num }))
    }
  }

  const handleRunUnitAmountChange = (runId: string, value: string) => {
    const num = parseFloat(value)
    if (value === "" || isNaN(num)) {
      setRunUnitAmounts((prev) => {
        const next = { ...prev }
        delete next[runId]
        return next
      })
    } else {
      setRunUnitAmounts((prev) => ({ ...prev, [runId]: num }))
    }
  }

  const handleTaskCostChange = (taskId: string, value: string) => {
    const num = parseFloat(value)
    if (value === "" || isNaN(num)) {
      setTaskCostOverrides((prev) => {
        const next = { ...prev }
        delete next[taskId]
        return next
      })
    } else {
      setTaskCostOverrides((prev) => ({ ...prev, [taskId]: num }))
    }
  }

  // ─── Totals ─────────────────────────────────────────────────────────
  const totalSelected = selectedRunIds.size + selectedTaskIds.size

  const totalAmount = useMemo(() => {
    const runTotal = eligibleRuns
      .filter((r: PayableRun) => selectedRunIds.has(r.run_id))
      .reduce((sum: number, r: PayableRun) => sum + getEffectiveRunTotal(r), 0)
    const taskTotal = eligibleTasks
      .filter((t) => selectedTaskIds.has(t.id))
      .reduce((sum, t) => sum + getEffectiveTaskCost(t), 0)
    return runTotal + taskTotal
  }, [
    eligibleRuns,
    selectedRunIds,
    getEffectiveRunTotal,
    eligibleTasks,
    selectedTaskIds,
    getEffectiveTaskCost,
  ])

  const clearSelection = useCallback(() => {
    setSelectedRunIds(new Set())
    setSelectedTaskIds(new Set())
  }, [])

  // ─── Rows ───────────────────────────────────────────────────────────
  const isLoading = runsLoading || tasksLoading

  /**
   * One list, runs and tasks together, in the order a partner reads them.
   *
   * Blocked rows are appended rather than interleaved: they cannot be acted on,
   * so putting them among the selectable ones would make the list longer
   * without making it more useful. They only appear at all when asked for.
   */
  type Row =
    | { kind: "run"; run: PayableRun }
    | { kind: "task"; task: PartnerAssignedTask }

  const visibleRows = useMemo((): Row[] => {
    const rows: Row[] = []
    if (typeFilter !== "tasks") {
      rows.push(...eligibleRuns.map((run: PayableRun) => ({ kind: "run" as const, run })))
    }
    if (typeFilter !== "runs") {
      rows.push(
        ...eligibleTasks.map((task: PartnerAssignedTask) => ({
          kind: "task" as const,
          task,
        }))
      )
    }
    if (showSubmitted && typeFilter !== "tasks") {
      rows.push(...blockedRuns.map((run: PayableRun) => ({ kind: "run" as const, run })))
    }
    return rows
  }, [typeFilter, eligibleRuns, eligibleTasks, showSubmitted, blockedRuns])

  /**
   * 🔑 An empty table must say WHICH kind of empty it is. "Nothing to bill" and
   * "nothing of the kind you filtered to" are different answers, and a partner
   * who has just filtered to Tasks and sees the generic message concludes their
   * finished runs have vanished.
   */
  const emptyMessage = useMemo(() => {
    if (typeFilter === "runs") {
      return blockedRuns.length && !showSubmitted
        ? `No runs left to bill — ${blockedRuns.length} are already submitted. Tick "Show already submitted" to see them.`
        : "No payable production runs yet. Runs appear here once you complete them."
    }
    if (typeFilter === "tasks") {
      return "No payable tasks. Completed tasks that are not part of a run appear here."
    }
    return blockedRuns.length && !showSubmitted
      ? `Nothing left to bill — ${blockedRuns.length} item(s) are already submitted. Tick "Show already submitted" to see them.`
      : "Nothing to bill yet. Completed runs and tasks appear here."
  }, [typeFilter, blockedRuns.length, showSubmitted])

  // ─── Submit ─────────────────────────────────────────────────────────
  const handleSubmit = async () => {
    if (totalSelected === 0) {
      toast.error("Select at least one run or task")
      return
    }

    // Validate runs: all must have a quantity and a unit amount
    const invalidRuns = eligibleRuns.filter(
      (r: PayableRun) =>
        selectedRunIds.has(r.run_id) &&
        (getEffectiveRunUnitAmount(r) <= 0 || getEffectiveRunQuantity(r) <= 0)
    )
    const invalidTasks = eligibleTasks.filter(
      (t) => selectedTaskIds.has(t.id) && getEffectiveTaskCost(t) <= 0
    )
    if (invalidRuns.length || invalidTasks.length) {
      const names = [
        ...invalidRuns.map((r: PayableRun) => r.design_name || r.run_id),
        ...invalidTasks.map((t) => t.title || t.id),
      ]
      toast.error(`Enter valid quantity and unit amount for: ${names.join(", ")}`)
      return
    }

    try {
      /**
       * A payment line is keyed by DESIGN, not by run — one design can have
       * several completed runs, and they collapse into a single line. So the
       * payload is grouped by design and the quantities SUMMED.
       *
       * 🔴 Summing matters. Assigning `quantities[designId]` per run leaves the
       * last run's figure standing and silently discards every earlier one: a
       * partner picking runs of 3 and 5 pieces would bill 5. That is #1554's
       * shape again — units a partner made going missing between the screen and
       * the money.
       */
      const productionRunIds: Record<string, string[]> = {}
      const quantities: Record<string, number> = {}
      const unitAmounts: Record<string, number> = {}
      const costOverrides: Record<string, number> = {}
      const ratesByDesign: Record<string, Set<number>> = {}
      const exactTotals: Record<string, number> = {}

      for (const run of eligibleRuns) {
        if (!selectedRunIds.has(run.run_id)) continue
        const designId = run.design_id
        const qty = getEffectiveRunQuantity(run)
        const rate = getEffectiveRunUnitAmount(run)

        ;(productionRunIds[designId] ||= []).push(run.run_id)
        quantities[designId] = (quantities[designId] ?? 0) + qty
        exactTotals[designId] = (exactTotals[designId] ?? 0) + qty * rate
        ;(ratesByDesign[designId] ||= new Set()).add(rate)
      }

      for (const [designId, rates] of Object.entries(ratesByDesign)) {
        if (rates.size === 1) {
          // One agreed rate across this design's runs — state it per unit, so
          // the reviewer sees the rate and the quantity that produced the sum.
          unitAmounts[designId] = [...rates][0]
        } else {
          /**
           * Two runs of one design at DIFFERENT agreed rates. A line carries a
           * single `unit_amount`, so no per-unit figure is honest here — using
           * either rate, or an average, misprices the work.
           *
           * `cost_overrides` is the line TOTAL and wins outright without being
           * multiplied by quantity, so the exact sum is billed while
           * `unit_amount` stays null — which is the truth: there isn't one.
           */
          costOverrides[designId] = Math.round(exactTotals[designId] * 100) / 100
        }
      }

      /**
       * Every design named in `production_run_ids` must also appear in
       * `design_ids` — the workflow throws otherwise. Omitting it made every
       * submission from this screen a 400.
       */
      const designIds = Object.keys(productionRunIds)

      await createSubmission({
        design_ids: designIds,
        task_ids: Array.from(selectedTaskIds),
        notes: notes || undefined,
        production_run_ids: designIds.length ? productionRunIds : undefined,
        quantities: Object.keys(quantities).length ? quantities : undefined,
        unit_amounts: Object.keys(unitAmounts).length ? unitAmounts : undefined,
        cost_overrides: Object.keys(costOverrides).length
          ? costOverrides
          : undefined,
        task_cost_overrides: Object.keys(taskCostOverrides).length
          ? taskCostOverrides
          : undefined,
      })
      toast.success("Payment submission created successfully")
      navigate("/payment-submissions")
    } catch (e: any) {
      toast.error(e?.message || "Failed to create submission")
    }
  }

  return (
    <RouteFocusModal prev="/payment-submissions">
      <RouteFocusModal.Header>
        <div className="flex w-full items-center justify-between">
          <div>
            <RouteFocusModal.Title>New Payment Submission</RouteFocusModal.Title>
            <RouteFocusModal.Description>
              Pick the runs and tasks you want paid for
            </RouteFocusModal.Description>
          </div>
        </div>
      </RouteFocusModal.Header>

      {/* FocusModal.Content is `overflow-hidden` and FocusModal.Body is only
          `flex-1` — the body does NOT scroll unless it asks to. Without
          `overflow-y-auto` a partner with more than a handful of eligible
          designs or tasks had the rest of the list clipped off the bottom of
          the modal with no way to reach it (the Submit button lives in the
          header, so the form still "worked" — you just couldn't see or pick
          anything past the fold). `min-h-0` lets the flex child actually shrink
          below its content height, which is what makes the scroll take effect. */}
      <RouteFocusModal.Body className="flex min-h-0 flex-1 flex-col gap-y-6 overflow-y-auto p-6 md:px-10 md:py-8">
        {/*
          Full width, not the 720px reading column this used to be.

          720px is right for a form you read top-to-bottom, which is what this
          screen was when it was a stack of cards. It is wrong for a table: five
          columns — work, qty, rate, amount, and a checkbox — inside 720px means
          the work column truncates the design name and the number inputs sit on
          top of each other, on a modal that is already occupying the whole
          screen. The container the content is in should be as wide as the thing
          the user opened.
        */}
        <div className="w-full">
          {/* Notes */}
          <div className="mb-6">
            <Text size="small" weight="plus" className="mb-2">
              Notes (optional)
            </Text>
            <Textarea
              placeholder="E.g., April batch — designs quality checked and tasks verified..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
            />
          </div>

          {/* ── Filter ────────────────────────────────────────────── */}
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-1 rounded-lg bg-ui-bg-subtle p-1">
              {(
                [
                  ["all", "All", eligibleRuns.length + eligibleTasks.length],
                  ["runs", "Runs", eligibleRuns.length],
                  ["tasks", "Tasks", eligibleTasks.length],
                ] as const
              ).map(([value, label, count]) => (
                <button
                  key={value}
                  type="button"
                  role="tab"
                  aria-selected={typeFilter === value}
                  data-state={typeFilter === value ? "active" : "inactive"}
                  onClick={() => setTypeFilter(value)}
                  className={
                    typeFilter === value
                      ? "txt-compact-small-plus rounded-md bg-ui-bg-base px-3 py-1 shadow-elevation-card-rest"
                      : "txt-compact-small rounded-md px-3 py-1 text-ui-fg-subtle"
                  }
                >
                  {label}
                  <Badge size="2xsmall" color="grey" className="ml-2">
                    {count}
                  </Badge>
                </button>
              ))}
            </div>

            {blockedRuns.length > 0 && (
              <label className="flex items-center gap-2 text-ui-fg-subtle txt-compact-small">
                <Checkbox
                  checked={showSubmitted}
                  onCheckedChange={(v) => setShowSubmitted(!!v)}
                  aria-label="Show already submitted"
                />
                Show already submitted ({blockedRuns.length})
              </label>
            )}
          </div>

          {/* ── One table of payable work ──────────────────────────── */}
          {isLoading && (
            <Container className="p-4">
              <Text size="small" className="text-ui-fg-subtle">
                Loading your payable work…
              </Text>
            </Container>
          )}

          {!isLoading && visibleRows.length === 0 && (
            <Container className="p-4">
              <Text size="small" className="text-ui-fg-subtle">
                {emptyMessage}
              </Text>
            </Container>
          )}

          {!isLoading && visibleRows.length > 0 && (
          <Container className="overflow-x-auto p-0">
            <Table>
              <Table.Header>
                <Table.Row>
                  <Table.HeaderCell className="w-[44px]">
                    <Checkbox
                      checked={allVisibleSelected}
                      onCheckedChange={toggleSelectAllVisible}
                      aria-label="Select all shown"
                    />
                  </Table.HeaderCell>
                  <Table.HeaderCell>Work</Table.HeaderCell>
                  <Table.HeaderCell className="text-right">Qty</Table.HeaderCell>
                  <Table.HeaderCell className="text-right">Rate</Table.HeaderCell>
                  <Table.HeaderCell className="text-right">Amount</Table.HeaderCell>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {visibleRows.map((row) =>
                  row.kind === "run" ? (
                    <RunRow
                      key={row.run.run_id}
                      run={row.run}
                      blockedReason={runBlockedReason(row.run)}
                      selected={selectedRunIds.has(row.run.run_id)}
                      onToggle={toggleRun}
                      quantity={getEffectiveRunQuantity(row.run)}
                      unitAmount={getEffectiveRunUnitAmount(row.run)}
                      onQuantityChange={handleRunQuantityChange}
                      onUnitAmountChange={handleRunUnitAmountChange}
                    />
                  ) : (
                    <TaskRow
                      key={row.task.id}
                      task={row.task}
                      selected={selectedTaskIds.has(row.task.id)}
                      onToggle={toggleTask}
                      cost={getEffectiveTaskCost(row.task)}
                      onCostChange={handleTaskCostChange}
                    />
                  )
                )}
              </Table.Body>
            </Table>
          </Container>
          )}
        </div>
      </RouteFocusModal.Body>

      {/*
        The command bar is where the selection lives now.
        Before, the running total and Submit sat in the modal HEADER while the
        list was tabbed below it — so the only place runs and tasks were ever
        added together was off-screen from whichever tab you were on, and the
        count could read zero while you had picks on the other tab. One list,
        one selection, one total, stated against the rows it came from.
      */}
      <CommandBar open={totalSelected > 0}>
        <CommandBar.Bar>
          <CommandBar.Value>
            <span data-testid="submission-total">
              {totalSelected} selected · INR {totalAmount.toLocaleString()}
            </span>
          </CommandBar.Value>
          <CommandBar.Seperator />
          <CommandBar.Command
            action={clearSelection}
            label="Clear"
            shortcut="c"
          />
          <CommandBar.Seperator />
          <CommandBar.Command
            action={handleSubmit}
            label="Submit for payment"
            shortcut="s"
            disabled={isCreating}
          />
        </CommandBar.Bar>
      </CommandBar>
    </RouteFocusModal>
  )
}

// ─── Rows ─────────────────────────────────────────────────────────────

const NumberCell = ({
  value,
  placeholder,
  onChange,
  label,
  disabled,
}: {
  value?: number
  placeholder: string
  onChange: (v: string) => void
  label: string
  disabled?: boolean
}) => (
  <Input
    type="number"
    size="small"
    className="w-24 text-right"
    aria-label={label}
    placeholder={placeholder}
    disabled={disabled}
    value={value != null ? String(value) : ""}
    onChange={(e) => onChange(e.target.value)}
    onClick={(e) => e.stopPropagation()}
  />
)

const RunRow = ({
  run,
  blockedReason,
  selected,
  onToggle,
  quantity,
  unitAmount,
  onQuantityChange,
  onUnitAmountChange,
}: {
  run: PayableRun
  blockedReason: string | null
  selected: boolean
  onToggle: (id: string) => void
  quantity: number
  unitAmount: number
  onQuantityChange: (id: string, value: string) => void
  onUnitAmountChange: (id: string, value: string) => void
}) => {
  const blocked = !!blockedReason
  const total = quantity * unitAmount

  return (
    <Table.Row
      data-run-id={run.run_id}
      data-testid="payable-run-row"
      className={blocked ? "opacity-60" : undefined}
    >
      <Table.Cell>
        <Checkbox
          checked={selected}
          disabled={blocked}
          onCheckedChange={() => !blocked && onToggle(run.run_id)}
          aria-label={`Select ${run.design_name || run.run_id}`}
        />
      </Table.Cell>

      <Table.Cell>
        <div className="flex items-center gap-2">
          <Text weight="plus" className="truncate">
            {run.design_name || "Unnamed work"}
          </Text>
          <Badge color="blue" size="2xsmall">
            Run
          </Badge>
          {run.billing_status === "unknown" && !blocked && (
            <Tooltip content="An earlier payout for this design did not record which runs it covered, so we cannot tell whether these pieces were already paid for.">
              <Badge color="orange" size="2xsmall">
                Unknown billing
              </Badge>
            </Tooltip>
          )}
          {blocked && (
            <Badge color="grey" size="2xsmall">
              {blockedReason}
            </Badge>
          )}
        </div>
        <div className="mt-1 flex items-center gap-3">
          <Text size="small" className="text-ui-fg-subtle">
            {run.quantity_basis === "produced"
              ? `${run.produced_quantity} made of ${run.ordered_quantity} ordered`
              : `${run.ordered_quantity} ordered`}
          </Text>
          {/*
            🔴 The TAIL of the id, not the head. `prod_run_` eats 9 characters
            and a ULID's leading digits are a TIMESTAMP, so every run of one
            design renders the same "prod_run_01K…" — and that is exactly the
            case that matters, since runs of one design collapse into a single
            payment line whose quantity is their sum.
          */}
          <Text size="small" className="font-mono text-ui-fg-muted">
            <span title={run.run_id}>…{run.run_id.slice(-8)}</span>
          </Text>
        </div>
      </Table.Cell>

      <Table.Cell className="text-right">
        <NumberCell
          label={`Quantity for ${run.design_name || run.run_id}`}
          placeholder={String(run.payable_quantity)}
          value={quantity !== run.payable_quantity ? quantity : undefined}
          disabled={blocked}
          onChange={(v) => onQuantityChange(run.run_id, v)}
        />
      </Table.Cell>

      <Table.Cell className="text-right">
        <NumberCell
          label={`Rate for ${run.design_name || run.run_id}`}
          placeholder={String(run.unit_amount)}
          value={unitAmount !== run.unit_amount ? unitAmount : undefined}
          disabled={blocked}
          onChange={(v) => onUnitAmountChange(run.run_id, v)}
        />
      </Table.Cell>

      <Table.Cell className="text-right">
        <Text
          size="small"
          weight="plus"
          data-testid={`run-amount-${run.run_id}`}
        >
          {quantity.toLocaleString()} × {unitAmount.toLocaleString()} ={" "}
          {total.toLocaleString()}
        </Text>
      </Table.Cell>
    </Table.Row>
  )
}

const TaskRow = ({
  task,
  selected,
  onToggle,
  cost,
  onCostChange,
}: {
  task: PartnerAssignedTask
  selected: boolean
  onToggle: (id: string) => void
  cost: number
  onCostChange: (id: string, value: string) => void
}) => (
  <Table.Row data-task-id={task.id} data-testid="payable-task-row">
    <Table.Cell>
      <Checkbox
        checked={selected}
        onCheckedChange={() => onToggle(task.id)}
        aria-label={`Select ${task.title || task.id}`}
      />
    </Table.Cell>

    <Table.Cell>
      <div className="flex items-center gap-2">
        <Text weight="plus" className="truncate">
          {task.title || "Untitled task"}
        </Text>
        <Badge color="purple" size="2xsmall">
          Task
        </Badge>
      </div>
      <Text size="small" className="mt-1 text-ui-fg-subtle">
        {task.status}
      </Text>
    </Table.Cell>

    {/*
      A task is one piece of work, not a quantity × rate. Stating "1" rather
      than leaving the cell blank keeps the Amount column readable as the same
      arithmetic in every row.
    */}
    <Table.Cell className="text-right">
      <Text size="small" className="text-ui-fg-muted">
        1
      </Text>
    </Table.Cell>

    <Table.Cell className="text-right">
      <NumberCell
        label={`Cost for ${task.title || task.id}`}
        placeholder="0"
        value={cost || undefined}
        onChange={(v) => onCostChange(task.id, v)}
      />
    </Table.Cell>

    <Table.Cell className="text-right">
      <Text size="small" weight="plus" data-testid={`task-amount-${task.id}`}>
        {cost.toLocaleString()}
      </Text>
    </Table.Cell>
  </Table.Row>
)

export const Component = PaymentSubmissionCreate
